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
  AuditChain,
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

/** Consume an SSE stream from the agent API: forwards each real pipeline-stage
 * event to `onStage` and resolves with the terminal OrchestratorResult. Uses
 * fetch (not EventSource) so the bearer token + POST body work. */
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

  const reader = res.body.getReader();
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

export function runAgentStream(sessionId: string, goal: string, onStage: OnStage): Promise<OrchestratorResult> {
  return streamOrchestrate(
    `${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/run/stream`,
    { goal },
    onStage,
    "runAgent",
  );
}

export function selectOptionStream(sessionId: string, itemId: string, onStage: OnStage): Promise<OrchestratorResult> {
  return streamOrchestrate(
    `${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/select/stream`,
    { item_id: itemId },
    onStage,
    "selectOption",
  );
}

/** Resume a NEEDS_HUMAN session with the human's approval. */
export async function approveSession(sessionId: string, cartId: string): Promise<OrchestratorResult> {
  const res = await authFetch(`${AGENT_URL}/sessions/${encodeURIComponent(sessionId)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cart_id: cartId }),
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
