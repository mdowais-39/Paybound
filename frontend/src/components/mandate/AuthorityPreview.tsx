import React from "react";
import { paiseToRupeesPlain } from "../../lib/money";
import {
  ShieldCheck,
  Lock,
  Clock,
  Store,
  Tag,
  CreditCard,
  CheckCircle2,
} from "lucide-react";

interface AuthorityPreviewProps {
  budgetPaise: number;
  capPaise: number;
  categories: string[];
  merchantName: string;
  expiryLabel: string;
  id?: string;
}

export const AuthorityPreview: React.FC<AuthorityPreviewProps> = ({
  budgetPaise,
  capPaise,
  categories,
  merchantName = "Demo Store",
  expiryLabel = "in 24 hours",
  id,
}) => {
  const formattedCategories =
    categories.length === 0
      ? "any catalog category"
      : categories.length === 1
      ? categories[0]
      : `${categories.slice(0, -1).join(", ")} and ${categories[categories.length - 1]}`;

  // Clean time string without double "in" or "until"
  const cleanExpiry = expiryLabel.replace(/^in\s+/i, "");

  return (
    <div
      id={id}
      className="bg-white border border-[#E5E7EB] rounded-xl shadow-xs flex flex-col justify-between h-full overflow-hidden"
    >
      {/* Card Header */}
      <div className="p-5 sm:p-6 pb-4 border-b border-[#F3F4F6]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center shrink-0 border border-[#DBEAFE]">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="font-mono text-xs uppercase tracking-wider font-semibold text-[#1E40AF] block">
                Authority Contract Preview
              </span>
              <span className="text-[11px] text-[#6B7280]">
                Cryptographically bound spend policy
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 px-2.5 py-0.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#059669] animate-pulse" />
            <span className="font-mono text-[10px] font-medium text-[#047857]">
              Live Bound
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="p-5 sm:p-6 pt-4 flex-1 flex flex-col gap-4">
        {/* Natural Language Contract Summary */}
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3.5">
          <p className="text-[13.5px] leading-relaxed text-[#334155]">
            This agent is authorized to spend up to{" "}
            <strong className="font-bold text-[#0F172A] font-mono tabular-nums bg-white px-1.5 py-0.5 rounded border border-[#CBD5E1]">
              {paiseToRupeesPlain(budgetPaise)}
            </strong>{" "}
            total, with a{" "}
            <strong className="font-bold text-[#0F172A] font-mono tabular-nums bg-white px-1.5 py-0.5 rounded border border-[#CBD5E1]">
              {paiseToRupeesPlain(capPaise)}
            </strong>{" "}
            per-purchase limit on{" "}
            <span className="font-semibold text-[#0F172A] capitalize">
              {formattedCategories}
            </span>{" "}
            at <strong className="font-semibold text-[#0F172A]">{merchantName}</strong>,
            valid for <strong className="font-semibold text-[#0F172A]">{cleanExpiry}</strong>.
          </p>
        </div>

        {/* Structured Spec Breakdown (Compact 2x2 Grid) */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Total Budget Envelope */}
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-[#6B7280] mb-1">
              <CreditCard className="w-3.5 h-3.5 text-[#2563EB]" />
              <span className="text-[11px] font-medium text-[#6B7280]">Total Budget</span>
            </div>
            <div className="font-mono text-sm font-bold text-[#111827] tabular-nums">
              {paiseToRupeesPlain(budgetPaise)}
            </div>
          </div>

          {/* Per-Transaction Cap */}
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-[#6B7280] mb-1">
              <Lock className="w-3.5 h-3.5 text-[#2563EB]" />
              <span className="text-[11px] font-medium text-[#6B7280]">Per-Txn Cap</span>
            </div>
            <div className="font-mono text-sm font-bold text-[#111827] tabular-nums">
              {paiseToRupeesPlain(capPaise)}
            </div>
          </div>

          {/* Merchant Scope */}
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-[#6B7280] mb-1">
              <Store className="w-3.5 h-3.5 text-[#2563EB]" />
              <span className="text-[11px] font-medium text-[#6B7280]">Merchant Target</span>
            </div>
            <div className="text-xs font-semibold text-[#111827] truncate">
              {merchantName}
            </div>
          </div>

          {/* Validity Duration */}
          <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-[#6B7280] mb-1">
              <Clock className="w-3.5 h-3.5 text-[#2563EB]" />
              <span className="text-[11px] font-medium text-[#6B7280]">Time Validity</span>
            </div>
            <div className="text-xs font-semibold text-[#111827] capitalize">
              {cleanExpiry}
            </div>
          </div>
        </div>

        {/* Category Scope Chips */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Tag className="w-3 h-3 text-[#6B7280]" />
            <span className="text-[11px] font-medium text-[#6B7280] uppercase tracking-wider font-mono">
              Authorized Categories ({categories.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.length === 0 ? (
              <span className="text-xs text-[#9CA3AF] italic">No categories selected</span>
            ) : (
              categories.map((cat) => (
                <span
                  key={cat}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#F1F5F9] text-[#334155] text-xs font-medium rounded-md border border-[#E2E8F0] capitalize"
                >
                  <CheckCircle2 className="w-3 h-3 text-[#059669]" />
                  {cat}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer Rule 9 Hard Guardrail */}
      <div className="p-4 bg-[#F8FAFC] border-t border-[#E5E7EB] flex items-start gap-2.5">
        <div className="w-5 h-5 rounded-full bg-[#FEF3C7] border border-[#FDE68A] text-[#D97706] flex items-center justify-center shrink-0 mt-0.5">
          <Lock className="w-3 h-3" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-[#475569] leading-snug">
            <strong className="font-semibold text-[#0F172A]">Mandate Kernel Guarantee:</strong> Purchases exceeding{" "}
            <span className="font-mono font-medium text-[#0F172A]">₹15,000</span> strictly require explicit Two-Factor Human Approval (AFA).
          </p>
        </div>
      </div>
    </div>
  );
};
