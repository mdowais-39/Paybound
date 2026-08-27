import React from "react";
import { UpsellSuggestion } from "../../lib/types";
import { paiseToRupees } from "../../lib/money";
import { Button } from "../shared/Button";
import { Sparkles, Plus, X } from "lucide-react";

interface UpsellPromptProps {
  message: string;
  suggestion: UpsellSuggestion;
  onAccept: () => void;
  onDecline: () => void;
  loading?: boolean;
  id?: string;
}

/** The UPSELL outcome: a real, in-stock complement was found for the
 * already-composed cart. Nothing is added automatically — the human accepts
 * or declines it here, and only THEN does the cart (with or without it) go
 * to the kernel gate. Mirrors ChoicePicker's "the agent proposes, the human
 * decides" pattern. */
export const UpsellPrompt: React.FC<UpsellPromptProps> = ({
  message,
  suggestion,
  onAccept,
  onDecline,
  loading = false,
  id,
}) => {
  return (
    <div
      id={id}
      className="bg-white border border-[#E5E7EB] border-l-4 border-l-[#7C3AED] rounded-xl p-5 sm:p-6 flex flex-col gap-4 shadow-xs"
    >
      <div className="flex items-center gap-2 pb-3 border-b border-[#E5E7EB]">
        <div className="w-8 h-8 rounded-lg bg-[#FAF5FF] border border-[#DDD6FE] flex items-center justify-center text-[#7C3AED]">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-[#111827]">One more thing?</h3>
          <p className="text-xs text-[#6B7280]">{message}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 bg-[#FAFAFA] border border-[#E5E7EB] rounded-lg p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#111827] leading-snug line-clamp-2">
            {suggestion.title}
          </p>
          <p className="text-[11px] text-[#6B7280] mt-1">
            <span className="font-medium text-[#4B5563]">{suggestion.category}</span>
          </p>
        </div>
        <span className="font-mono font-bold text-[#111827] tabular-nums shrink-0">
          {paiseToRupees(suggestion.price_paise)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="solid" size="md" loading={loading} onClick={onAccept}>
          <Plus className="w-4 h-4" />
          Add to cart
        </Button>
        <Button variant="outline" size="md" disabled={loading} onClick={onDecline}>
          <X className="w-4 h-4" />
          No thanks
        </Button>
      </div>

      <p className="text-[11px] text-[#6B7280] font-mono pt-1">
        Purely optional — the agent will not add this for you. Your original item is already composed either way.
      </p>
    </div>
  );
};
