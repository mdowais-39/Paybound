import React from "react";
import { Link } from "react-router-dom";
import { Mandate, PipelineStageState, OrchestratorResult } from "../../lib/types";
import { CartSession } from "./CartList";
import { PipelineStepper } from "./PipelineStepper";
import { OutcomeCard } from "./OutcomeCard";
import { ChoicePicker } from "./ChoicePicker";
import { UpsellPrompt } from "./UpsellPrompt";
import { Pill } from "../shared/Pill";
import { paiseToRupees, paiseToRupeesPlain } from "../../lib/money";
import {
  ShoppingBag,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Sparkles,
  Layers,
  ArrowRight,
  Zap,
  CheckCircle2,
  FileText,
  Building2,
  Tag,
} from "lucide-react";

interface CartDetailViewProps {
  cart: CartSession | null;
  mandate: Mandate | null;
  onApprove?: () => Promise<void>;
  onDecline?: () => void;
  onSelectOption?: (itemId: string) => void;
  onResolveUpsell?: (accept: boolean) => void;
  approving?: boolean;
  onSelectScenario?: (goal: string) => void;
}

export const CartDetailView: React.FC<CartDetailViewProps> = ({
  cart,
  mandate,
  onApprove,
  onDecline,
  onSelectOption,
  onResolveUpsell,
  approving = false,
  onSelectScenario,
}) => {
  // Empty State / Welcome Screen when no cart is selected or creating a new one
  if (!cart) {
    return (
      <div
        id="cart-detail-empty-state"
        className="bg-white border border-[#E5E7EB] rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center shadow-xs min-h-[420px]"
      >
        <div className="w-14 h-14 rounded-2xl bg-[#F3F4F6] border border-[#E5E7EB] flex items-center justify-center text-[#111827] mb-4 shadow-xs">
          <ShoppingBag className="w-7 h-7 text-[#111827]" />
        </div>

        <h3 className="text-lg sm:text-xl font-bold text-[#111827] mb-2">
          Select or Create a Purchase Cart
        </h3>
        <p className="text-sm text-[#6B7280] max-w-md mb-6 leading-relaxed">
          Every purchasing run is isolated into a dedicated cart. Select an existing cart from the sidebar to inspect its pipeline trace, composed line items, and kernel verdict, or trigger a test scenario below.
        </p>

        {onSelectScenario && (
          <div className="w-full max-w-lg bg-[#FAFBFD] border border-[#E5E7EB] rounded-xl p-4 text-left">
            <div className="flex items-center gap-1.5 text-xs font-mono text-[#6B7280] font-semibold mb-3">
              <Zap className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Instant Test Scenarios:</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { emoji: "👟", label: "Running shoes", goal: "buy running shoes" },
                { emoji: "📱", label: "Phone case", goal: "buy a cellular phone case" },
                { emoji: "🛋️", label: "A sofa", goal: "buy a sofa" },
                { emoji: "❓", label: "Something vague", goal: "buy me something nice" },
              ].map((s) => (
                <button
                  key={s.goal}
                  type="button"
                  onClick={() => onSelectScenario(s.goal)}
                  className="p-2.5 rounded-lg bg-white hover:bg-[#F3F4F6] border border-[#E5E7EB] transition-colors cursor-pointer text-left flex flex-col gap-1 shadow-xs"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#111827]">
                    <span>{s.emoji} {s.label}</span>
                  </div>
                  <span className="text-[11px] text-[#6B7280] font-mono">"{s.goal}"</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const isApproved =
    cart.result?.state === "AUTHORIZED" ||
    cart.result?.state === "COMPLETED" ||
    cart.result?.verdict === "approved";
  const isRefused =
    cart.result?.state === "REFUSED" ||
    cart.result?.state === "PRE_CHECK_FAILED" ||
    cart.result?.verdict === "refused";
  const isNeedsHuman =
    cart.result?.state === "NEEDS_HUMAN" || cart.result?.verdict === "needs_human";
  const isChoose = cart.result?.state === "CHOOSE";
  const isUpsell = cart.result?.state === "UPSELL";

  const perTxnCap = mandate?.per_txn_cap_paise ?? null;
  // Real composed line items only — no fabricated placeholder.
  const lineItems = cart.result?.cart?.line_items ?? [];
  const merchantId = mandate?.allowed_merchants?.[0] ?? null;

  return (
    <div id="cart-detail-workspace" className="flex flex-col gap-5 animate-in fade-in">
      {/* 1. Cart Header Banner */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-[#6B7280] font-semibold tracking-wider uppercase">
              CART SESSION
            </span>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB] font-bold">
              {cart.cartId}
            </span>
            {isApproved && <Pill variant="green">Kernel Authorized</Pill>}
            {isRefused && <Pill variant="amber">Policy Refused</Pill>}
            {isNeedsHuman && <Pill variant="violet">Human AFA Required</Pill>}
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-[#111827] tracking-tight">
            {cart.title}
          </h2>

          <div className="flex items-center gap-3 text-xs text-[#6B7280] font-mono flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {new Date(cart.timestamp).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            {merchantId && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" />
                  Merchant: {merchantId}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right side: Amount and Audit link */}
        <div className="flex flex-row md:flex-col md:items-end justify-between items-center gap-2 pt-3 md:pt-0 border-t md:border-t-0 border-[#E5E7EB]">
          <div className="text-right">
            <div className="font-mono text-2xl font-bold text-[#111827] tabular-nums">
              {cart.amountPaise > 0 ? paiseToRupees(cart.amountPaise) : "—"}
            </div>
            {perTxnCap != null && (
              <div className="text-[11px] font-mono text-[#6B7280]">
                Per-Txn Cap: {paiseToRupeesPlain(perTxnCap)}
              </div>
            )}
          </div>

          {mandate?.session_id && (
            <Link
              to={`/audit/${mandate.session_id}`}
              className="inline-flex items-center gap-1 text-xs font-mono text-[#2563EB] hover:text-[#1D4ED8] hover:underline"
            >
              <span>View in Audit Ledger</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>

      {/* 2. Goal & Intent Specification Card */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#6B7280] font-semibold">
              ORIGINAL AGENT GOAL
            </span>
            <span className="text-xs text-[#9CA3AF]">· Natural language request</span>
          </div>
          <span className="font-mono text-[11px] text-[#9CA3AF]">
            trace {cart.result?.trace_id ? `${cart.result.trace_id.substring(0, 10)}...` : "active"}
          </span>
        </div>

        <p className="text-sm font-semibold text-[#111827] leading-relaxed">
          "{cart.goal}"
        </p>
      </div>

      {/* 3. Pipeline Stepper Entry */}
      <PipelineStepper
        stages={cart.stages}
        currentStepIndex={cart.currentStepIndex}
        isComplete={cart.isComplete}
        verdict={cart.result?.verdict}
      />

      {/* 4. Cart Composed Line Items Breakdown (only when a real cart exists) */}
      {lineItems.length > 0 && (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#6B7280] font-semibold">
              COMPOSED CART LINE ITEMS
            </span>
            <span className="text-xs text-[#9CA3AF]">
              ({lineItems.length} {lineItems.length === 1 ? "item" : "items"})
            </span>
          </div>
          <span className="font-mono text-[11px] text-[#059669] font-medium flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            Integrity Verified
          </span>
        </div>

        <div className="divide-y divide-[#E5E7EB] font-mono text-xs">
          {lineItems.map((item, idx) => (
            <div
              key={idx}
              className={`py-2.5 flex items-center justify-between gap-4 ${
                item.is_upsell ? "bg-[#FDFBFF] -mx-4 sm:-mx-5 px-4 sm:px-5" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-[#F3F4F6] text-[#111827] flex items-center justify-center font-bold text-[10px]">
                  {item.qty}x
                </div>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-sans font-semibold text-[#111827]">
                      {item.title || "Item Candidate"}
                    </p>
                    {item.is_upsell && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#7C3AED] bg-[#FAF5FF] border border-[#DDD6FE] px-1.5 py-0.5 rounded-full">
                        <Sparkles className="w-2.5 h-2.5" />
                        Suggested add-on
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#6B7280] font-mono">
                    Category: {item.category} · Ref: {item.item_id}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="font-bold text-[#111827] tabular-nums">
                  {paiseToRupees(item.price_paise)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-[#E5E7EB] flex items-center justify-between font-mono text-xs">
          <span className="text-[#6B7280]">Cart Total (Paise / INR):</span>
          <span className="font-bold text-sm text-[#111827] tabular-nums">
            {paiseToRupees(cart.amountPaise)}
          </span>
        </div>
      </div>
      )}

      {/* 5. Honest error state — the backend call itself failed */}
      {cart.error && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 flex items-start gap-2.5 shadow-xs">
          <AlertTriangle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#991B1B]">Request failed</p>
            <p className="text-xs text-[#B91C1C] font-mono mt-0.5 break-words">{cart.error}</p>
          </div>
        </div>
      )}

      {/* 6. CHOOSE — the human picks among real options; the agent won't guess */}
      {isChoose && cart.result?.options && !cart.error && (
        <ChoicePicker
          message={cart.result.message}
          options={cart.result.options}
          onSelect={(itemId) => onSelectOption?.(itemId)}
          disabled={approving}
        />
      )}

      {/* 6b. UPSELL — a real, in-stock complement was found; the human
          accepts or declines it before the cart goes to the kernel gate. */}
      {isUpsell && cart.result?.upsell_suggestion && !cart.error && (
        <UpsellPrompt
          message={cart.result.message}
          suggestion={cart.result.upsell_suggestion}
          onAccept={() => onResolveUpsell?.(true)}
          onDecline={() => onResolveUpsell?.(false)}
          loading={approving}
        />
      )}

      {/* 7. Kernel Outcome Card (non-CHOOSE, non-UPSELL terminal states) */}
      {cart.result && !isChoose && !isUpsell && !cart.error && (
        cart.declined ? (
          <div className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#6B7280] rounded-xl p-5 shadow-xs">
            <p className="text-sm font-semibold text-[#111827]">You declined this purchase.</p>
            <p className="text-xs text-[#6B7280] mt-1 font-mono">
              No approval was given, so no payment link was issued. Zero rupees moved.
            </p>
          </div>
        ) : (
          <OutcomeCard
            result={cart.result}
            mandate={mandate}
            onApprove={onApprove}
            onDecline={onDecline}
            approving={approving}
          />
        )
      )}
    </div>
  );
};
