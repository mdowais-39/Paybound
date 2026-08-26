import React from "react";
import { AuditChain } from "../../lib/types";
import { AuditEntryCard } from "./AuditEntryCard";
import { VerifyBadge } from "./VerifyBadge";
import { RefreshCw } from "lucide-react";

interface AuditTimelineProps {
  chain: AuditChain | null;
  loading: boolean;
  onRefresh: () => void;
  id?: string;
}

export const AuditTimeline: React.FC<AuditTimelineProps> = ({
  chain,
  loading,
  onRefresh,
  id,
}) => {
  if (loading && !chain) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center shadow-xs">
        <RefreshCw className="w-6 h-6 animate-spin text-[#2563EB] mx-auto mb-2" />
        <p className="font-mono text-xs text-[#6B7280]">Verifying SHA-256 hash chain and loading events...</p>
      </div>
    );
  }

  if (!chain || chain.entries.length === 0) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center shadow-xs">
        <p className="font-mono text-xs text-[#6B7280]">No audit records found for this session.</p>
      </div>
    );
  }

  return (
    <div id={id} className="flex flex-col gap-6">
      {/* 1. Unmissable Verify Badge at the top */}
      <VerifyBadge
        verified={chain.verified}
        sessionId={chain.session_id}
        entryCount={chain.entries.length}
      />

      {/* Header & Refresh */}
      <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
            Immutable Hash-Chained Timeline
          </h3>
          <p className="text-xs text-[#9CA3AF]">
            Every state transition, rule gate, and monetary effect recorded chronologically.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-[#111827] hover:text-[#000000] bg-white hover:bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-1.5 rounded-lg shadow-xs transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* 2. Hash-Chain Rail */}
      <div className="pl-2 sm:pl-4">
        {chain.entries.map((entry, index) => (
          <AuditEntryCard
            key={entry.seq}
            entry={entry}
            isLast={index === chain.entries.length - 1}
          />
        ))}
      </div>
    </div>
  );
};
