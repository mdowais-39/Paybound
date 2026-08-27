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

export interface PipelineStageState {
  id: "pre_checks" | "parsing" | "searching" | "composing" | "kernel_gate" | "outcome";
  label: string;
  status: "idle" | "pending" | "active" | "success" | "refused" | "needs_human";
  detail?: string;
}
