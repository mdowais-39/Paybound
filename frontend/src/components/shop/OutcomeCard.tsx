import React from "react";
import { OrchestratorResult, Mandate } from "../../lib/types";
import { Pill } from "../shared/Pill";
import { Button } from "../shared/Button";
import { paiseToRupees, paiseToRupeesPlain } from "../../lib/money";
import { getRefusalMeta } from "../../lib/verdictMeta";
import { ExternalLink, CheckCircle2, AlertTriangle, HelpCircle, Check, X, ShieldAlert } from "lucide-react";

interface OutcomeCardProps {
  result: OrchestratorResult;
  mandate: Mandate | null;
  onApprove?: () => Promise<void>;
  onDecline?: () => void;
  approving?: boolean;
  id?: string;
}

export const OutcomeCard: React.FC<OutcomeCardProps> = ({
  result,
  mandate,
  onApprove,
  onDecline,
  approving = false,
  id,
}) => {
  const isApproved =
    result.state === "AUTHORIZED" ||
    result.state === "COMPLETED" ||
    result.verdict === "approved";
  const isRefused =
    result.state === "REFUSED" ||
    result.state === "PRE_CHECK_FAILED" ||
    result.verdict === "refused";
  const isNeedsHuman =
    result.state === "NEEDS_HUMAN" || result.verdict === "needs_human";
  const isClarify = result.state === "CLARIFY";

  const refusalMeta = getRefusalMeta(result.rule_cited);

  // Real amounts only — no fabricated fallback.
  const cartAmount = result.amount_paise ?? result.cart?.total_paise ?? 0;
  const perTxnCap = mandate?.per_txn_cap_paise ?? null;
  const llmCalls = result.llm_calls;
  const traceShort = result.trace_id ? `${result.trace_id.substring(0, 10)}...` : "—";
  const firstItemTitle = result.cart?.line_items?.[0]?.title ?? null;

  // 1. APPROVED / AUTHORIZED OUTCOME
  if (isApproved) {
    return (
      <div
        id={id}
        className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#059669] rounded-xl p-5 sm:p-6 flex flex-col gap-4 shadow-xs"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <Pill variant="green">Authorized</Pill>
            <span className="font-mono text-xs text-[#059669] font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Kernel Verified
            </span>
          </div>
          <span className="font-mono text-xs text-[#9CA3AF]">
            trace {traceShort} · LLM calls: {llmCalls ?? "—"}
          </span>
        </div>

        {/* Amount and Cap context */}
        <div className="flex items-baseline gap-2.5 font-mono">
          <span className="text-2xl sm:text-3xl font-bold text-[#111827] tabular-nums">
            {paiseToRupees(cartAmount)}
          </span>
          {perTxnCap != null && (
            <span className="text-sm text-[#6B7280]">
              of {paiseToRupeesPlain(perTxnCap)} per-txn cap
            </span>
          )}
        </div>

        {/* Cart Line Items */}
        <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3.5 text-xs">
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
            Cart Composed by Agent
          </div>
          <div className="flex items-center justify-between font-mono text-[#111827]">
            <span>{firstItemTitle ?? "Composed cart"}</span>
            <span className="font-semibold tabular-nums">
              {paiseToRupees(cartAmount)}
            </span>
          </div>
        </div>

        {/* Message */}
        <p className="text-sm text-[#111827] leading-relaxed">
          {result.message || "Authorized by Mandate Kernel. Complete payment via test rail."}
        </p>

        {/* Payment Action Link */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-3 border-t border-[#E5E7EB]">
          {result.payment_link && result.payment_link.startsWith("dry-run://") ? (
            // The backend is running with PAYBOUND_DRY_RUN=true — the kernel
            // gate and audit chain are fully real, but the Razorpay call was
            // intentionally skipped to conserve the test-mode account's
            // limited payment-link quota. This is never a clickable link.
            <span className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-xs font-mono text-[#92400E]">
              <span className="font-bold">DRY RUN</span>
              <span>Kernel approved — no real Razorpay call was made (quota-saving mode).</span>
            </span>
          ) : result.payment_link ? (
            <>
              <a
                href={result.payment_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-[#111827] hover:bg-[#1F2937] text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer shadow-xs"
              >
                <span>Open payment link</span>
                <ExternalLink className="w-4 h-4" />
              </a>
              <span className="font-mono text-xs text-[#6B7280]">
                Pay with UPI <code className="text-[#111827] font-semibold bg-[#F3F4F6] px-1.5 py-0.5 rounded-md">success@razorpay</code> in test mode
              </span>
            </>
          ) : (
            <span className="font-mono text-xs text-[#6B7280]">
              Authorized by the kernel. No payment link was returned (the payment rail is unavailable in this environment).
            </span>
          )}
        </div>
      </div>
    );
  }

  // 2. REFUSED OUTCOME (Amber, confident explained decision)
  if (isRefused) {
    return (
      <div
        id={id}
        className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#D97706] rounded-xl p-5 sm:p-6 flex flex-col gap-4 shadow-xs"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <Pill variant="amber">Refused</Pill>
            {result.rule_cited && (
              <Pill variant="amber">{result.rule_cited}</Pill>
            )}
          </div>
          <span className="font-mono text-xs text-[#9CA3AF]">
            trace {traceShort} · LLM calls: {llmCalls ?? "—"}
          </span>
        </div>

        {/* Amount vs Cap */}
        <div className="flex items-baseline gap-2.5 font-mono">
          <span className="text-2xl font-bold text-[#D97706] tabular-nums">
            {paiseToRupees(cartAmount)}
          </span>
          {perTxnCap != null && (
            <span className="text-sm text-[#6B7280]">
              vs {paiseToRupeesPlain(perTxnCap)} per-txn cap
            </span>
          )}
        </div>

        {/* Refusal Plain-Language Explanation */}
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#111827]">
                {result.message || refusalMeta?.description || "Transaction refused by Mandate Kernel."}
              </p>
              {refusalMeta && (
                <p className="text-xs text-[#6B7280] mt-1 font-mono">
                  Cited Bound: {refusalMeta.badgeLabel}
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-[#6B7280] font-mono">
          Zero rupees moved. The kernel enforced policy boundaries without human intervention.
        </p>
      </div>
    );
  }

  // 3. NEEDS HUMAN (Violet, Human AFA / PIN Approval required)
  if (isNeedsHuman) {
    return (
      <div
        id={id}
        className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#7C3AED] rounded-xl p-5 sm:p-6 flex flex-col gap-4 shadow-xs"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <Pill variant="violet">Needs Human Approval</Pill>
            <Pill variant="violet">AFA / Rule 9</Pill>
          </div>
          <span className="font-mono text-xs text-[#9CA3AF]">
            trace {traceShort} · LLM calls: {llmCalls ?? "—"}
          </span>
        </div>

        {/* Amount */}
        <div className="flex items-baseline gap-2.5 font-mono">
          <span className="text-2xl font-bold text-[#7C3AED] tabular-nums">
            {paiseToRupees(cartAmount)}
          </span>
          <span className="text-xs font-mono text-[#6B7280]">
            (Exceeds ₹15,000 threshold)
          </span>
        </div>

        {/* Context Note */}
        <div className="bg-[#FAF5FF] border border-[#DDD6FE] rounded-lg p-3.5">
          <p className="text-sm text-[#111827]">
            {result.message || "This high-value purchase exceeds ₹15,000 and requires explicit customer authorization before the kernel issues a payment link."}
          </p>
        </div>

        {/* Approval Prompt Buttons */}
        <div className="flex items-center gap-3 pt-3 border-t border-[#E5E7EB]">
          <Button
            variant="solid"
            size="md"
            loading={approving}
            onClick={() => onApprove?.()}
          >
            <Check className="w-4 h-4" />
            Authorize Purchase
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={onDecline}
          >
            <X className="w-4 h-4" />
            Decline
          </Button>
        </div>
      </div>
    );
  }

  // 4. CLARIFY OUTCOME (Slate, Asking follow-up)
  return (
    <div
      id={id}
      className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#6B7280] rounded-xl p-5 sm:p-6 flex flex-col gap-3 shadow-xs"
    >
      <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
        <Pill variant="slate">Clarification Requested</Pill>
        <span className="font-mono text-xs text-[#9CA3AF]">
          LLM calls: {llmCalls ?? "—"}
        </span>
      </div>

      <div className="flex items-start gap-2.5">
        <HelpCircle className="w-4 h-4 text-[#6B7280] shrink-0 mt-0.5" />
        <p className="text-sm font-semibold text-[#111827]">
          {result.clarification_question || result.message || "Please provide more details on your search intent."}
        </p>
      </div>
    </div>
  );
};
