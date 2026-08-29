import React from "react";
import { CampaignOffer } from "../../lib/types";
import { Button } from "../shared/Button";
import { Sparkles, ArrowRight, X } from "lucide-react";

interface CampaignBannerProps {
  offer: CampaignOffer;
  onAccept: () => void;
  onDismiss: () => void;
  disabled?: boolean;
  id?: string;
}

const TYPE_LABEL: Record<CampaignOffer["campaign_type"], string> = {
  complete_the_set: "Complete the set",
  win_back: "Since you were away",
};

/** The campaign orchestrator's in-app nudge — a proactive cross-sell / win-back
 * suggestion built from the mandate's REAL purchase history. It only ever
 * proposes a goal + reason; "Try it" runs that goal through the ordinary,
 * fully kernel-gated pipeline (nothing is bought here). Distinct indigo accent
 * separates it from the in-cart UpsellPrompt (violet) — this one is proactive,
 * that one is mid-purchase. */
export const CampaignBanner: React.FC<CampaignBannerProps> = ({
  offer,
  onAccept,
  onDismiss,
  disabled = false,
  id,
}) => {
  return (
    <div
      id={id}
      className="relative bg-gradient-to-r from-[#EEF2FF] to-white border border-[#C7D2FE] rounded-2xl p-4 sm:p-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-white border border-[#C7D2FE] flex items-center justify-center text-[#4F46E5] shrink-0 shadow-xs">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-[10px] uppercase tracking-wider font-bold text-[#4F46E5] bg-[#E0E7FF] px-2 py-0.5 rounded-full">
              {TYPE_LABEL[offer.campaign_type]}
            </span>
          </div>
          <p className="text-sm text-[#111827] leading-relaxed">{offer.reason}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        <Button variant="solid" size="sm" disabled={disabled} onClick={onAccept}>
          Try it <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={disabled}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-mono text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Dismiss this suggestion"
        >
          <X className="w-3.5 h-3.5" /> Not now
        </button>
      </div>
    </div>
  );
};
