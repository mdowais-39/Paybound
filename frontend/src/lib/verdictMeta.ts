import { RefusalRule, Verdict, SessionOutcome, AuditEventType } from "./types";

export interface RefusalMeta {
  code: RefusalRule;
  label: string;
  ruleNumber: number;
  description: string;
  badgeLabel: string;
}

export const REFUSAL_RULES_META: Record<RefusalRule, RefusalMeta> = {
  mandate_revoked: {
    code: "mandate_revoked",
    label: "Mandate Revoked",
    ruleNumber: 1,
    description: "The user triggered the instant kill-switch. All pending purchases blocked.",
    badgeLabel: "RULE 1: MANDATE_REVOKED",
  },
  signature_invalid: {
    code: "signature_invalid",
    label: "Invalid Ed25519 Signature",
    ruleNumber: 2,
    description: "Cryptographic signature verification failed. Mandate envelope untrusted.",
    badgeLabel: "RULE 2: SIGNATURE_INVALID",
  },
  mandate_expired: {
    code: "mandate_expired",
    label: "Mandate Expired",
    ruleNumber: 3,
    description: "Transaction attempted after the mandate's defined TTL window.",
    badgeLabel: "RULE 3: MANDATE_EXPIRED",
  },
  cart_integrity_mismatch: {
    code: "cart_integrity_mismatch",
    label: "Cart Integrity Mismatch",
    ruleNumber: 4,
    description: "Price or hash mismatch detected between discovery and checkout.",
    badgeLabel: "RULE 4: CART_INTEGRITY_MISMATCH",
  },
  category_not_allowed: {
    code: "category_not_allowed",
    label: "Category Not Allowed",
    ruleNumber: 5,
    description: "Item category is not present on the authorized category allow-list.",
    badgeLabel: "RULE 5: CATEGORY_NOT_ALLOWED",
  },
  merchant_not_allowed: {
    code: "merchant_not_allowed",
    label: "Merchant Not Allowed",
    ruleNumber: 6,
    description: "Merchant ID is outside the scope of authorized merchants.",
    badgeLabel: "RULE 6: MERCHANT_NOT_ALLOWED",
  },
  over_per_txn_cap: {
    code: "over_per_txn_cap",
    label: "Over Per-Transaction Cap",
    ruleNumber: 7,
    description: "Cart amount exceeds the single-purchase spending ceiling.",
    badgeLabel: "RULE 7: OVER_PER_TXN_CAP",
  },
  over_cumulative_budget: {
    code: "over_cumulative_budget",
    label: "Over Cumulative Budget",
    ruleNumber: 8,
    description: "Cumulative session spend plus this cart exceeds total allocated budget.",
    badgeLabel: "RULE 8: OVER_CUMULATIVE_BUDGET",
  },
  requires_human_afa: {
    code: "requires_human_afa",
    label: "Requires Human Approval (AFA)",
    ruleNumber: 9,
    description: "High-value transaction (>₹15,000) requires explicit human consent.",
    badgeLabel: "RULE 9: REQUIRES_HUMAN_AFA",
  },
};

export function getRefusalMeta(rule: RefusalRule | null | string): RefusalMeta | null {
  if (!rule) return null;
  return REFUSAL_RULES_META[rule as RefusalRule] || {
    code: rule as RefusalRule,
    label: rule,
    ruleNumber: 0,
    description: "Kernel policy violation",
    badgeLabel: rule.toUpperCase(),
  };
}

export function getVerdictBadgeProps(verdict: Verdict | SessionOutcome | string | null | undefined): {
  colorVariant: "green" | "amber" | "violet" | "slate" | "rust";
  label: string;
} {
  if (!verdict) {
    return { colorVariant: "slate", label: "PENDING" };
  }

  const v = verdict.toLowerCase();

  if (v === "approved" || v === "authorized" || v === "completed") {
    return { colorVariant: "green", label: v.toUpperCase() };
  }
  if (v === "refused" || v === "pre_check_failed") {
    return { colorVariant: "amber", label: "REFUSED" };
  }
  if (v === "needs_human") {
    return { colorVariant: "violet", label: "NEEDS HUMAN" };
  }
  if (v === "clarify") {
    return { colorVariant: "slate", label: "CLARIFY" };
  }
  if (v === "revoked") {
    return { colorVariant: "slate", label: "REVOKED" };
  }
  if (v === "gate_decision") {
    return { colorVariant: "rust", label: "KERNEL GATE" };
  }

  return { colorVariant: "slate", label: v.toUpperCase() };
}

export function getAuditEventMeta(eventType: AuditEventType | string): {
  label: string;
  colorVariant: "green" | "amber" | "violet" | "slate" | "rust" | "blue";
  isGate: boolean;
} {
  switch (eventType) {
    case "gate_decision":
      return { label: "GATE_DECISION", colorVariant: "rust", isGate: true };
    case "session_created":
      return { label: "SESSION_CREATED", colorVariant: "slate", isGate: false };
    case "pre_check_passed":
      return { label: "PRE_CHECK_PASSED", colorVariant: "green", isGate: false };
    case "pre_check_failed":
      return { label: "PRE_CHECK_FAILED", colorVariant: "amber", isGate: false };
    case "worker_dispatched":
      return { label: "WORKER_DISPATCHED", colorVariant: "slate", isGate: false };
    case "confidence_scored":
      return { label: "CONFIDENCE_SCORED", colorVariant: "slate", isGate: false };
    case "cart_built":
      return { label: "CART_BUILT", colorVariant: "slate", isGate: false };
    case "token_issued":
      return { label: "TOKEN_ISSUED", colorVariant: "green", isGate: false };
    case "payment_effect":
      return { label: "PAYMENT_EFFECT", colorVariant: "green", isGate: false };
    case "revoked":
      return { label: "REVOKED", colorVariant: "slate", isGate: false };
    case "narrative_ready":
      return { label: "NARRATIVE_READY", colorVariant: "slate", isGate: false };
    default:
      return { label: eventType.toUpperCase(), colorVariant: "slate", isGate: false };
  }
}
