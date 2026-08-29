// The real backend client. Every function here calls the actual Rust/Python
// services — the gateway (:8080) for mandates/sessions/audit and the agent API
// (:8092) for running a session. There is NO mock fallback and NO parallel
// Firestore store for this data: if the backend is unreachable or refuses, we
// throw, and the UI shows an honest error. Nothing on screen is ever
// fabricated. (Firebase is used only for login; see lib/token.ts for how a
// logged-in user maps to a stable backend bearer token.)

import { GATEWAY_URL, AGENT_URL } from "./config";
import { authFetch } from "./token";
import {
  Mandate,
  AgentRun,
  AuditChain,
  AuditLogEntry,
  AuditLogFilters,
  AuditEntryContext,
  CampaignOffer,
  OrchestratorResult,
  SessionView,
} from "./types";

async function asJson(res: Response, what: string): Promise<any> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail || body?.error || JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`${what} failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

// ---- catalog -------------------------------------------------------------

export async function getCategories(merchantId?: string): Promise<string[]> {
  const url = `${GATEWAY_URL}/catalog/categories${merchantId ? `?merchant_id=${encodeURIComponent(merchantId)}` : ""}`;
  const res = await fetch(url); // public endpoint, no auth
  const data = await asJson(res, "getCategories");
  return Array.isArray(data) ? data : [];
}

// ---- mandates ------------------------------------------------------------

/** The gateway returns each mandate already joined to its bound session's live
 * state and spend, which is exactly the frontend Mandate shape. */
export async function listMandates(): Promise<Mandate[]> {
  const res = await authFetch(`${GATEWAY_URL}/mandates`);
  const data = await asJson(res, "listMandates");
  return Array.isArray(data) ? data.map(normalizeMandate) : [];
}

export async function createMandate(input: {
  payer?: string;
  budget_total_paise: number;
  per_txn_cap_paise: number;
  allowed_categories?: string[];
  merchant_id?: string | null;
  ttl_seconds?: number;
  nl_goal?: string;
}): Promise<Mandate> {
  const body: Record<string, unknown> = {
    budget_total_paise: input.budget_total_paise,
    per_txn_cap_paise: input.per_txn_cap_paise,
  };
  if (input.payer) body.payer = input.payer;
  if (input.allowed_categories?.length) body.allowed_categories = input.allowed_categories;
  if (input.merchant_id) body.merchant_id = input.merchant_id;
  if (input.ttl_seconds) body.ttl_seconds = input.ttl_seconds;
  if (input.nl_goal) body.nl_goal = input.nl_goal;

  const res = await authFetch(`${GATEWAY_URL}/mandates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await asJson(res, "createMandate");
  // A freshly created mandate's session is DELEGATED with zero spend.
  return normalizeMandate({
    ...data,
    revoked: false,
    session_state: "DELEGATED",
    running_spend_paise: 0,
  });
}

export async function revokeMandate(mandateId: string): Promise<void> {
  const res = await authFetch(`${GATEWAY_URL}/mandates/${encodeURIComponent(mandateId)}/revoke`, {
    method: "POST",
  });
  await asJson(res, "revokeMandate");
}

// ---- run history (durable console carts, DB-backed) ----------------------

/** A mandate's agent runs, newest-first — the console's source of truth. Each
 * carries the full OrchestratorResult so cards rebuild faithfully across
 * devices and cache clears. */
export async function listRuns(mandateId: string): Promise<AgentRun[]> {
  const res = await authFetch(`${GATEWAY_URL}/mandates/${encodeURIComponent(mandateId)}/runs`);
  const data = await asJson(res, "listRuns");
  return Array.isArray(data) ? (data as AgentRun[]) : [];
}

// ---- campaign orchestrator (in-app nudges) -------------------------------

/** The at-most-one campaign nudge for this session's mandate, or null. Purely
 * a suggestion — accepting runs its `suggested_goal` through the ordinary /run
 * pipeline. */
export async function getCampaignOffer(sessionId: string): Promise<CampaignOffer | null> {
  const res = await authFetch(`${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/campaign`);
  const data = await asJson(res, "getCampaignOffer");
  return (data?.offer as CampaignOffer | null) ?? null;
}

/** Log the human's accept/dismiss on a shown offer (a UI-only record; the
 * actual purchase, on accept, is driven separately through /run). */
export async function resolveCampaignOffer(
  sessionId: string,
  offerId: string,
  status: "accepted" | "dismissed",
): Promise<void> {
  const res = await authFetch(
    `${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/campaign/${encodeURIComponent(offerId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  await asJson(res, "resolveCampaignOffer");
}

/** Permanently delete one run from the durable history. */
export async function deleteRun(mandateId: string, runId: string): Promise<void> {
  const res = await authFetch(
    `${GATEWAY_URL}/mandates/${encodeURIComponent(mandateId)}/runs/${encodeURIComponent(runId)}`,
    { method: "DELETE" },
  );
  await asJson(res, "deleteRun");
}

// ---- sessions ------------------------------------------------------------

export async function getSession(sessionId: string): Promise<SessionView> {
  const res = await authFetch(`${GATEWAY_URL}/sessions/${encodeURIComponent(sessionId)}`);
  return asJson(res, "getSession");
}

export async function getAuditChain(sessionId: string): Promise<AuditChain> {
  const res = await authFetch(`${GATEWAY_URL}/sessions/${encodeURIComponent(sessionId)}/audit`);
  const data = await asJson(res, "getAuditChain");
  // The gateway already returns { session_id, verified, entry_count, entries[] }
  // with the exact AuditEntry field names (seq, event_type, prev_hash,
  // this_hash, payload, narrative, ts).
  return data as AuditChain;
}

/** The flat, cross-session audit log with server-side filtering — the left
 * list of the two-pane audit viewer. */
export async function getAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (filters.eventTypes?.length) params.set("event_type", filters.eventTypes.join(","));
  if (filters.verdicts?.length) params.set("verdict", filters.verdicts.join(","));
  if (filters.days) params.set("days", String(filters.days));
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.sessionId) params.set("session_id", filters.sessionId);
  const qs = params.toString();
  const res = await authFetch(`${GATEWAY_URL}/audit${qs ? `?${qs}` : ""}`);
  const data = await asJson(res, "getAuditLog");
  return Array.isArray(data?.entries) ? (data.entries as AuditLogEntry[]) : [];
}

/** The mandate authority behind a single audit entry (detail pane). */
export async function getAuditEntryContext(entryId: string): Promise<AuditEntryContext> {
  const res = await authFetch(`${GATEWAY_URL}/audit/entries/${encodeURIComponent(entryId)}/context`);
  return asJson(res, "getAuditEntryContext") as Promise<AuditEntryContext>;
}

// ---- agent (run / select / approve) --------------------------------------

export async function runAgent(sessionId: string, goal: string): Promise<OrchestratorResult> {
  const res = await authFetch(`${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  return asJson(res, "runAgent");
}

/** Resume a CHOOSE session with the human's picked item. */
export async function selectOption(sessionId: string, itemId: string): Promise<OrchestratorResult> {
  const res = await authFetch(`${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: itemId }),
  });
  return asJson(res, "selectOption");
}

// ---- streaming variants (real per-stage pipeline progress via SSE) --------

export type StageEvent = { id: string; status: string };
export type OnStage = (evt: StageEvent) => void;

/** Consume a `text/event-stream` body: forwards each `{type:"stage"}` event to
 * `onStage` and resolves with the terminal `{type:"result"}` payload. Handles
 * SSE framing (events split on a blank line, `data:` prefix) and chunk
 * boundaries that fall mid-event. Exported so it can be unit-tested directly
 * against a fabricated ReadableStream. */
export async function consumeOrchestratorStream(
  stream: ReadableStream<Uint8Array>,
  onStage: OnStage,
  what: string,
): Promise<OrchestratorResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: OrchestratorResult | null = null;

  const handleEvent = (raw: string) => {
    const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
    if (!dataLine) return;
    const evt = JSON.parse(dataLine.slice(5).trim());
    if (evt.type === "stage") onStage({ id: evt.id, status: evt.status });
    else if (evt.type === "result") result = evt.result as OrchestratorResult;
    else if (evt.type === "error") throw new Error(`${what} failed: ${evt.detail || "stream error"}`);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) if (part.trim()) handleEvent(part);
  }
  if (buffer.trim()) handleEvent(buffer);

  if (!result) throw new Error(`${what} ended without a result`);
  return result;
}

/** POST to an SSE endpoint (with the bearer token + body — hence fetch, not
 * EventSource) and consume the stream. */
async function streamOrchestrate(
  url: string,
  body: Record<string, unknown>,
  onStage: OnStage,
  what: string,
): Promise<OrchestratorResult> {
  const res = await authFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    // Surface a normal error (401/403/404/500) the same way the JSON endpoints do.
    return asJson(res, what) as Promise<never>;
  }
  return consumeOrchestratorStream(res.body, onStage, what);
}

// `runId` is a stable client idempotency key threaded through a run's
// run→select→approve steps, so the backend logs them all under one `agent_run`
// row. `goal` is passed on every step so the durable log keeps the human's
// words even on steps that don't restate them.
export function runAgentStream(
  sessionId: string,
  goal: string,
  onStage: OnStage,
  runId?: string,
): Promise<OrchestratorResult> {
  return streamOrchestrate(
    `${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/run/stream`,
    { goal, run_id: runId },
    onStage,
    "runAgent",
  );
}

export function selectOptionStream(
  sessionId: string,
  itemId: string,
  onStage: OnStage,
  runId?: string,
  goal?: string,
): Promise<OrchestratorResult> {
  return streamOrchestrate(
    `${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/select/stream`,
    { item_id: itemId, run_id: runId, goal },
    onStage,
    "selectOption",
  );
}

/** Resume an UPSELL-paused session with the human's accept/decline on the
 * suggested complement. `addonItemId` is required only when accepting — the
 * exact item_id from `upsell_suggestion`, never re-searched. */
export function resolveUpsellStream(
  sessionId: string,
  itemId: string,
  accept: boolean,
  addonItemId: string | undefined,
  onStage: OnStage,
  runId?: string,
  goal?: string,
  // The UPSELL result's own cart_id — on decline, the backend checks that
  // exact cart out as-is instead of rebuilding it (avoids a confusing
  // duplicate cart_built audit entry for an unchanged cart).
  cartId?: string,
): Promise<OrchestratorResult> {
  return streamOrchestrate(
    `${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/upsell/stream`,
    { item_id: itemId, accept, addon_item_id: addonItemId, cart_id: cartId, run_id: runId, goal },
    onStage,
    "resolveUpsell",
  );
}

/** Resume a NEEDS_HUMAN session with the human's approval. */
export async function approveSession(
  sessionId: string,
  cartId: string,
  runId?: string,
  goal?: string,
): Promise<OrchestratorResult> {
  const res = await authFetch(`${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cart_id: cartId, run_id: runId, goal }),
  });
  return asJson(res, "approveSession");
}

// ---- helpers -------------------------------------------------------------

function normalizeMandate(m: any): Mandate {
  return {
    mandate_id: m.mandate_id,
    session_id: m.session_id ?? undefined,
    payer: m.payer,
    budget_total_paise: m.budget_total_paise,
    per_txn_cap_paise: m.per_txn_cap_paise,
    allowed_categories: m.allowed_categories ?? [],
    allowed_merchants: m.allowed_merchants ?? [],
    ttl_unix: m.ttl_unix,
    nl_goal: m.nl_goal,
    revoked: !!m.revoked,
    session_state: m.session_state ?? undefined,
    running_spend_paise: m.running_spend_paise ?? 0,
  };
}
