import React from "react";
import { OrchestratorOption } from "../../lib/types";
import { paiseToRupees } from "../../lib/money";
import { Layers, ArrowRight } from "lucide-react";

interface ChoicePickerProps {
  message: string;
  options: OrchestratorOption[];
  onSelect: (itemId: string) => void;
  disabled?: boolean;
  id?: string;
}

/** The CHOOSE outcome: the agent found several plausible in-bounds matches and
 * refuses to guess which the customer wants. Rendered as a real picker (not a
 * chat bubble) — selecting one calls POST /sessions/{id}/select with that
 * item_id, resolved deterministically by the backend. */
export const ChoicePicker: React.FC<ChoicePickerProps> = ({
  message,
  options,
  onSelect,
  disabled = false,
  id,
}) => {
  return (
    <div
      id={id}
      className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#2563EB] rounded-xl p-5 sm:p-6 flex flex-col gap-4 shadow-xs"
    >
      <div className="flex items-center gap-2 pb-3 border-b border-[#E5E7EB]">
        <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center text-[#2563EB]">
          <Layers className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#111827]">Choose a product</h3>
          <p className="text-xs text-[#6B7280]">{message}</p>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-[#E5E7EB]">
        {options.map((o) => (
          <button
            key={o.item_id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(o.item_id)}
            className="py-3 flex items-center justify-between gap-4 text-left group hover:bg-[#F9FAFB] -mx-2 px-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#111827] truncate">{o.title}</p>
              <p className="text-[11px] text-[#6B7280] font-mono truncate">
                {o.category} · {o.item_id}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono font-bold text-[#111827] tabular-nums">
                {paiseToRupees(o.price_paise)}
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] opacity-0 group-hover:opacity-100 transition-opacity">
                Select <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </button>
        ))}
      </div>

      <p className="text-[11px] text-[#6B7280] font-mono pt-1">
        The agent will not pick for you — selecting one is re-checked against your mandate before any cart is built.
      </p>
    </div>
  );
};
