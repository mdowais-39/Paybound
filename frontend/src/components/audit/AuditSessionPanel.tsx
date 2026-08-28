import React, { useState, useEffect } from "react";
import { AuditLogEntry } from "../../lib/types";
import { getAuditLog, getAuditChain } from "../../lib/api";
import { getAuditEventMeta } from "../../lib/verdictMeta";
import { paiseToRupees } from "../../lib/money";
import { Pill } from "../shared/Pill";
import { AuditEntryDetail } from "./AuditEntryDetail";
import {
  ScrollText,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

interface AuditSessionPanelProps {
  sessionId: string | null;
}

const verdictVariant = (v: string | null): "green" | "amber" | "violet" | "slate" => {
  if (v === "approved") return "green";
  if (v === "refused") return "amber";
  if (v === "needs_human") return "violet";
  return "slate";
};

/** The right pane's "cart story" view — the full sequence of ONE session's
 * audit entries, read top to bottom like the purchase actually happened
 * (session created → cart built → gate decision → token issued → payment
 * effect...), instead of that story being scattered across a flat, cross-
 * session list. Click any stage to expand its full detail (narrative, hash-
 * chain link, mandate authority, raw payload) inline. */
export const AuditSessionPanel: React.FC<AuditSessionPanelProps> = ({ sessionId }) => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async (sid: string) => {
    setLoading(true);
    setError(null);
    try {
      const [rows, chain] = await Promise.all([
        getAuditLog({ sessionId: sid }),
        getAuditChain(sid).catch(() => null),
      ]);
      // getAuditLog returns newest-first (for browsing); a "story" reads
      // chronologically, so reverse it here.
      setEntries([...rows].reverse());
      setVerified(chain?.verified ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load this session's audit trail.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExpandedId(null);
    if (sessionId) load(sessionId);
    else {
      setEntries([]);
      setVerified(null);
    }
  }, [sessionId]);

  // Narration runs in the background on the server — quietly re-fetch a few
  // times if any loaded entry is still missing its narrative.
  useEffect(() => {
    if (!sessionId || loading || entries.length === 0) return;
    if (!entries.some((e) => !e.narrative)) return;
    const t = setTimeout(() => load(sessionId), 3000);
    return () => clearTimeout(t);
  }, [entries, loading, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sessionId) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-xs h-full min-h-[420px]">
        <div className="w-12 h-12 rounded-xl bg-[#F3F4F6] border border-[#E5E7EB] flex items-center justify-center text-[#6B7280] mb-3">
          <ScrollText className="w-6 h-6" />
        </div>
        <p className="text-sm font-semibold text-[#111827]">Select a cart session</p>
        <p className="text-xs text-[#6B7280] mt-1 max-w-[240px]">
          Pick any session from the left to read its full story — every stage, in order.
        </p>
      </div>
    );
  }

  // The mandate's nl_goal defaults to a generic placeholder ("shop within
  // budget") whenever a mandate is created without one — real, but not
  // identifying. Prefer a cart/gate/payment narrative (built from the actual
  // items and amounts) for the title, falling back to nl_goal only when it's
  // a genuine human-typed goal.
  const goalEntry = entries.find((e) => e.event_type === "session_created");
  const goal = (goalEntry?.payload as any)?.nl_goal as string | undefined;
  const identifying = entries.find(
    (e) => (e.event_type === "cart_built" || e.event_type === "gate_decision" || e.event_type === "payment_effect") && e.narrative,
  )?.narrative;
  const title = identifying ?? (goal && goal !== "shop within budget" ? `"${goal}"` : undefined);
  const finalVerdictEntry = [...entries].reverse().find((e) => e.verdict);
  const totalPaise = finalVerdictEntry?.amount_paise ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Session header */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1">
              Cart Session
            </div>
            <p className="text-sm font-semibold text-[#111827] leading-snug line-clamp-2">
              {title ?? `Session ${sessionId.substring(0, 12)}…`}
            </p>
            <p className="font-mono text-[11px] text-[#9CA3AF] mt-0.5">{sessionId}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {finalVerdictEntry?.verdict && (
              <Pill variant={verdictVariant(finalVerdictEntry.verdict)}>{finalVerdictEntry.verdict}</Pill>
            )}
            {totalPaise != null && (
              <span className="font-mono text-sm font-bold text-[#111827] tabular-nums">
                {paiseToRupees(totalPaise)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-[#F3F4F6] text-[11px] font-mono">
          {verified === true && (
            <span className="inline-flex items-center gap-1 text-[#059669] font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" /> Chain verified
            </span>
          )}
          {verified === false && (
            <span className="inline-flex items-center gap-1 text-[#DC2626] font-semibold">
              <ShieldAlert className="w-3.5 h-3.5" /> Chain BROKEN — tampering detected
            </span>
          )}
          <span className="text-[#9CA3AF] ml-auto">{entries.length} stages</span>
        </div>
      </div>

      {/* Stage-by-stage story */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-4 sm:p-5">
        {error ? (
          <p className="text-xs text-[#B91C1C] font-mono text-center py-6">{error}</p>
        ) : loading && entries.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-xs text-[#9CA3AF] font-mono py-8">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="flex flex-col">
            {entries.map((e, idx) => {
              const meta = getAuditEventMeta(e.event_type);
              const isLast = idx === entries.length - 1;
              const isOpen = expandedId === e.entry_id;
              return (
                <div key={e.entry_id} className="relative flex gap-3">
                  {/* Rail */}
                  <div className="flex flex-col items-center shrink-0">
                    <div
                      className={`w-2.5 h-2.5 rounded-full mt-1.5 ${
                        meta.isGate ? "bg-[#DC2626] ring-4 ring-[#FEE2E2]" : "bg-[#2563EB]"
                      }`}
                    />
                    {!isLast && <div className="w-px flex-1 bg-[#E5E7EB] my-1" />}
                  </div>

                  {/* Stage row */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : e.entry_id)}
                    className="flex-1 min-w-0 text-left pb-4 cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
                      )}
                      <Pill variant={meta.colorVariant as any}>{meta.label}</Pill>
                      {e.verdict && <Pill variant={verdictVariant(e.verdict)}>{e.verdict}</Pill>}
                      {e.amount_paise != null && (
                        <span className="font-mono text-xs font-bold text-[#111827] tabular-nums">
                          {paiseToRupees(e.amount_paise)}
                        </span>
                      )}
                      <span className="font-mono text-[10.5px] text-[#9CA3AF] ml-auto">
                        {new Date(e.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-sm text-[#374151] mt-1 group-hover:text-[#111827] transition-colors">
                      {e.narrative || (
                        <span className="text-[#9CA3AF] italic font-mono text-xs">Generating narrative summary…</span>
                      )}
                    </p>

                    {isOpen && (
                      <div className="mt-3" onClick={(ev) => ev.stopPropagation()}>
                        <AuditEntryDetail entry={e} />
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
