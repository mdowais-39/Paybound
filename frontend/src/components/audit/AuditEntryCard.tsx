import React, { useState } from "react";
import { AuditEntry } from "../../lib/types";
import { Pill } from "../shared/Pill";
import { getAuditEventMeta } from "../../lib/verdictMeta";
import { ChevronDown, ChevronRight, Copy, Check, ArrowRight, Shield } from "lucide-react";

interface AuditEntryCardProps {
  entry: AuditEntry;
  isLast: boolean;
  id?: string;
}

export const AuditEntryCard: React.FC<AuditEntryCardProps> = ({
  entry,
  isLast,
  id,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);

  const eventMeta = getAuditEventMeta(entry.event_type);
  const isGate = eventMeta.isGate;

  const truncateHash = (hash: string | null) => {
    if (!hash) return "GENESIS (null)";
    if (hash.length <= 16) return hash;
    return `${hash.substring(0, 8)}...${hash.substring(hash.length - 8)}`;
  };

  const handleCopyHash = () => {
    navigator.clipboard.writeText(entry.this_hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  return (
    <div id={id} className="relative flex items-start gap-4 sm:gap-6 group">
      {/* Continuous Vertical Timeline Rail Line */}
      {!isLast && (
        <div className="absolute left-[13px] sm:left-[15px] top-7 bottom-0 w-[2px] bg-[#E5E7EB] group-hover:bg-[#D1D5DB] transition-colors" />
      )}

      {/* Timeline Node */}
      <div className="relative z-10 shrink-0 mt-1">
        {isGate ? (
          // Solid Red/Rust-filled node for gate_decision
          <div
            className="w-7 sm:w-8 h-7 sm:h-8 rounded-full bg-[#DC2626] text-white flex items-center justify-center shadow-xs ring-4 ring-[#FEE2E2]"
            title="Kernel Gating Point"
          >
            <Shield className="w-4 h-4" />
          </div>
        ) : (
          // Blue-bordered node for standard events
          <div className="w-7 sm:w-8 h-7 sm:h-8 rounded-full bg-white border-2 border-[#2563EB] flex items-center justify-center shadow-xs">
            <div className="w-2 h-2 rounded-full bg-[#2563EB]" />
          </div>
        )}
      </div>

      {/* Main Entry Card Body */}
      <div
        className={`flex-1 bg-white border rounded-xl p-4 sm:p-5 mb-5 transition-all shadow-xs ${
          isGate
            ? "border-l-4 border-l-[#DC2626] border-[#E5E7EB] bg-[#FAFAFA]"
            : "border-[#E5E7EB] hover:border-[#D1D5DB]"
        }`}
      >
        {/* Top Header Row: Seq, Event Pill, Timestamp */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pb-2.5 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-bold text-[#111827] bg-[#F3F4F6] px-2 py-0.5 rounded-md border border-[#E5E7EB]">
              #{entry.seq}
            </span>
            <Pill variant={eventMeta.colorVariant as any}>
              {eventMeta.label}
            </Pill>
            {isGate && (
              <span className="font-mono text-[10.5px] uppercase tracking-wider font-bold text-[#DC2626] bg-[#FEE2E2] px-2 py-0.5 rounded-full">
                Deterministic Rule Check
              </span>
            )}
          </div>

          <span className="font-mono text-[11px] text-[#9CA3AF] whitespace-nowrap">
            {new Date(entry.ts).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>

        {/* Narrative Description Sentence */}
        <div className="my-3">
          <p className="text-[14.5px] leading-relaxed text-[#111827] font-sans">
            {entry.narrative || (
              <span className="text-[#9CA3AF] italic font-mono text-xs">
                Generating narrative summary...
              </span>
            )}
          </p>
        </div>

        {/* Hash Chain Linkage Row */}
        <div className="flex items-center flex-wrap gap-2 text-[11px] font-mono text-[#6B7280] bg-[#F9FAFB] p-2.5 rounded-lg border border-[#E5E7EB]">
          <span className="text-[#9CA3AF]">chain:</span>
          <span className="text-[#6B7280]" title={entry.prev_hash || "Genesis"}>
            {truncateHash(entry.prev_hash)}
          </span>
          <ArrowRight className="w-3 h-3 text-[#9CA3AF]" />
          <span className="font-semibold text-[#111827]" title={entry.this_hash}>
            {truncateHash(entry.this_hash)}
          </span>
          <button
            type="button"
            onClick={handleCopyHash}
            className="text-[#6B7280] hover:text-[#111827] transition-colors p-0.5 ml-auto cursor-pointer"
            title="Copy this_hash"
          >
            {copiedHash ? <Check className="w-3.5 h-3.5 text-[#059669]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Expandable Payload Drawer */}
        <div className="mt-3 pt-2.5 border-t border-dashed border-[#E5E7EB]">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 font-mono text-xs text-[#2563EB] hover:text-[#1D4ED8] transition-colors cursor-pointer"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span>payload</span>
            <span className="text-[10px] text-[#9CA3AF]">
              ({Object.keys(entry.payload || {}).length} fields)
            </span>
          </button>

          {isOpen && (
            <div className="mt-2.5 p-3.5 bg-[#111827] text-[#F9FAFB] rounded-lg font-mono text-[11.5px] overflow-x-auto max-h-60 leading-relaxed shadow-xs">
              <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
