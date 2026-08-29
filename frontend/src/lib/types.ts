export interface CatalogItem {
  item_id: string;
  merchant_id: string;
  title: string;
  category: string;
  price_paise: number;
  availability: boolean;
}

export interface CartLineItem {
  item_id: string;
  title?: string;
  qty: number;
  price_paise: number;
  category: string;
  /** True when the agent added this line as a complementary suggestion (e.g.
   * sporting goods with running shoes), not something the customer asked for. */
  is_upsell?: boolean;
}

export interface CartView {
  cart_id: string;
  session_id: string;
  merchant_id: string;
  line_items: CartLineItem[];
  total_paise: number;
}

export type Verdict = "approved" | "refused" | "needs_human";

export type RefusalRule =
  | "mandate_revoked"
  | "signature_invalid"
  | "mandate_expired"
  | "cart_integrity_mismatch"
  | "category_not_allowed"
  | "merchant_not_allowed"
  | "over_per_txn_cap"
  | "over_cumulative_budget"
  | "requires_human_afa";

export interface CheckoutResult {
  verdict: Verdict;
  rule_cited: RefusalRule | null;
  human_message: string | null;
  amount_paise: number;
  cart_hash: string;
  payment_link: string | null;
  razorpay_ref: string | null;
}

export type SessionOutcome =
  | "AUTHORIZED"
  | "COMPLETED"
  | "REFUSED"
  | "NEEDS_HUMAN"
  | "CLARIFY"
  | "CHOOSE"
  | "UPSELL"
  | "PRE_CHECK_FAILED";

/** One selectable product when the agent finds several plausible matches
 * (state === "CHOOSE"). The human picks; the agent never guesses. Resolved
 * via POST /sessions/{id}/select. */
export interface OrchestratorOption {
  item_id: string;
  title: string;
  category: string;
  price_paise: number;
  merchant_id: string;
}

/** A proposed complement for the already-composed cart (state === "UPSELL").
 * Not yet in the cart — the human accepts or declines it via
 * POST /sessions/{id}/upsell. The agent never adds it on its own. */
export interface UpsellSuggestion {
  item_id: string;
  title: string;
  category: string;
  price_paise: number;
}

export interface OrchestratorResult {
  state: SessionOutcome;
  message: string;
  verdict: Verdict | null;
  rule_cited: RefusalRule | string | null;
  payment_link: string | null;
  clarification_question: string | null;
  cart_id: string | null;
  options?: OrchestratorOption[] | null;
  trace_id?: string | null;
  llm_calls?: number;
  // Convenience fields the frontend derives/carries; not all come from the backend.
  cart?: CartView | null;
  amount_paise?: number;
  upsell_suggestion?: UpsellSuggestion | null;
}

/** An in-app campaign nudge (GET /sessions/{id}/campaign). The engine only ever
 * proposes a natural-language goal + reason from real purchase history —
 * accepting runs `suggested_goal` through the ordinary kernel-gated /run
 * pipeline. Never carries a price or a cart; it's a suggestion, not a charge. */
export interface CampaignOffer {
  offer_id: string;
  campaign_type: "complete_the_set" | "win_back";
  reason: string;
  suggested_goal: string;
  status: "shown" | "accepted" | "dismissed";
}

/** One durable run from the console history (GET /mandates/{id}/runs). `result`
 * is the full OrchestratorResult snapshot the backend produced, so the console
 * rebuilds each card faithfully from the DB — not from per-browser storage. */
export interface AgentRun {
  run_id: string;
  session_id: string;
  goal: string;
  state: SessionOutcome;
  verdict: Verdict | null;
  rule_cited: string | null;
  cart_id: string | null;
  total_paise: number;
  message: string | null;
  payment_link: string | null;
  result: OrchestratorResult;
  created_at: string;
  updated_at: string;
}

/** Live session view from GET /sessions/{id} (gateway). */
export interface SessionView {
  session_id: string;
  mandate_id: string;
  state: SessionState;
  running_spend_paise: number;
  budget_total_paise: number;
  per_txn_cap_paise: number;
  latest_cart_id: string | null;
}

export interface Mandate {
  mandate_id: string;
  session_id?: string;
  payer: string;
  budget_total_paise: number;
  per_txn_cap_paise: number;
  allowed_categories: string[];
  allowed_merchants: string[];
  ttl_unix: number;
  nl_goal: string;
  revoked?: boolean;
  session_state?: SessionState;
  running_spend_paise?: number;
}

export type SessionState =
  | "DELEGATED"
  | "SHOPPING"
  | "CART_BUILT"
  | "GATING"
  | "AUTHORIZED"
  | "PAYING"
  | "COMPLETED"
  | "REFUSED"
  | "NEEDS_HUMAN"
  | "REVOKED";

export type AuditEventType =
  | "session_created"
  | "pre_check_passed"
  | "pre_check_failed"
  | "worker_dispatched"
  | "confidence_scored"
  | "cart_built"
  | "gate_decision"
  | "token_issued"
  | "payment_effect"
  | "revoked"
  | "narrative_ready";

export interface AuditEntry {
  seq: number;
  event_type: AuditEventType;
  prev_hash: string | null;
  this_hash: string;
  payload: Record<string, unknown>;
  narrative: string | null;
  ts: string;
}

export interface AuditChain {
  session_id: string;
  verified: boolean;
  entry_count: number;
  entries: AuditEntry[];
}

/** One row of the flat, cross-session audit log (GET /audit). Carries the
 * mandate/session ids and the fields lifted from the payload (verdict,
 * rule_cited, amount) so the list row is legible without opening it. */
export interface AuditLogEntry {
  entry_id: string;
  seq: number;
  session_id: string;
  mandate_id: string;
  event_type: AuditEventType;
  verdict: Verdict | null;
  rule_cited: string | null;
  amount_paise: number | null;
  narrative: string | null;
  prev_hash: string | null;
  this_hash: string;
  payload: Record<string, unknown>;
  ts: string;
}

/** Filters for the audit log — all optional. `sessionId` is an exact match,
 * independent of the other filters — used to fetch one session's full "cart
 * story" entry set. */
export interface AuditLogFilters {
  eventTypes?: AuditEventType[];
  verdicts?: Verdict[];
  days?: number;
  q?: string;
  sessionId?: string;
}

/** The mandate authority behind one audit entry (GET /audit/entries/{id}/context). */
export interface AuditEntryContext {
  session_id: string;
  mandate_id: string;
  payer: string;
  budget_total_paise: number;
  per_txn_cap_paise: number;
  allowed_categories: string[];
  allowed_merchants: string[];
  ttl_unix: number;
  nl_goal: string;
  revoked: boolean;
}

export interface PipelineStageState {
  id: "pre_checks" | "parsing" | "searching" | "composing" | "kernel_gate" | "outcome";
  label: string;
  status: "idle" | "pending" | "active" | "success" | "refused" | "needs_human";
  detail?: string;
}
