import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { getAuditLog, getAuditChain } from "../lib/api";
import { AuditLogEntry, AuditEventType, Verdict } from "../lib/types";
import { getAuditEventMeta } from "../lib/verdictMeta";
import { paiseToRupees } from "../lib/money";
import { Pill } from "../components/shared/Pill";
import { AuditEntryDetail } from "../components/audit/AuditEntryDetail";
import {
  ScrollText,
  ShieldCheck,
  Search,
  RefreshCw,
  Shield,
  Loader2,
} from "lucide-react";

// Event types worth filtering on (the noisy internal ones are still searchable,
// just not surfaced as one-click chips).
const EVENT_FILTERS: { value: AuditEventType; label: string }[] = [
  { value: "gate_decision", label: "Gate" },
  { value: "cart_built", label: "Cart" },
  { value: "payment_effect", label: "Payment" },
  { value: "token_issued", label: "Token" },
  { value: "session_created", label: "Session" },
  { value: "pre_check_failed", label: "Pre-check fail" },
  { value: "revoked", label: "Revoked" },
];

const VERDICT_FILTERS: { value: Verdict; label: string; variant: "green" | "amber" | "violet" }[] = [
  { value: "approved", label: "Approved", variant: "green" },
  { value: "refused", label: "Refused", variant: "amber" },
  { value: "needs_human", label: "Needs human", variant: "violet" },
];

const DAY_OPTIONS = [
  { value: 0, label: "All time" },
  { value: 1, label: "Last 24h" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
];

/** The Audit Trail Viewer — a flat, filterable log of every state transition,
 * rule gate, and monetary effect across ALL of the user's sessions (left), with
 * a full drill-down for the selected event (right). Every hash, narrative, and
 * amount is real backend data from GET /audit; nothing here is fabricated. */
export const AuditPage: React.FC = () => {
  const { sessionId: paramSessionId } = useParams<{ sessionId: string }>();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [days, setDays] = useState(30);
  const [eventTypes, setEventTypes] = useState<AuditEventType[]>([]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  // Deep-link from "View in Audit Ledger" pre-filters to that session.
  const [sessionFilter, setSessionFilter] = useState<string | null>(paramSessionId ?? null);
  // When ONE session is in focus, we can show its real verify_chain() result —
  // the cryptographic proof that the whole chain is untampered. Across sessions
  // a single verdict is meaningless, so it only appears when filtered to one.
  const [sessionVerified, setSessionVerified] = useState<boolean | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const searchTerm = sessionFilter || q;
      const rows = await getAuditLog({
        q: searchTerm || undefined,
        days: days || undefined,
        eventTypes: eventTypes.length ? eventTypes : undefined,
        verdicts: verdicts.length ? verdicts : undefined,
      });
      setEntries(rows);
      setUpdatedAt(new Date());
    } catch (e: any) {
      setError(e?.message || "Failed to load the audit log.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [q, days, eventTypes, verdicts, sessionFilter]);

  // Debounced reload on any filter change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load]);

  // Keep a valid selection: default to the first entry, clear if it vanished.
  useEffect(() => {
    if (entries.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !entries.some((e) => e.entry_id === selectedId)) {
      setSelectedId(entries[0].entry_id);
    }
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the real verify_chain() verdict for the focused session (only when
  // exactly one session is filtered — otherwise a single verdict is meaningless).
  useEffect(() => {
    if (!sessionFilter) {
      setSessionVerified(null);
      return;
    }
    let cancelled = false;
    setSessionVerified(null);
    getAuditChain(sessionFilter)
      .then((c) => !cancelled && setSessionVerified(c.verified))
      .catch(() => !cancelled && setSessionVerified(null));
    return () => {
      cancelled = true;
    };
  }, [sessionFilter]);

  // Narration runs in the background on the server, so freshly-recorded
  // entries can arrive here without a narrative for a few seconds. If any
  // loaded entry lacks one, quietly re-fetch a few times until they fill in —
  // instead of leaving the user to guess that Refresh would help.
  useEffect(() => {
    if (loading || !entries.some((e) => !e.narrative)) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [entries, loading, load]);

  const selected = entries.find((e) => e.entry_id === selectedId) || null;

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const clearFilters = () => {
    setQ("");
    setDays(30);
    setEventTypes([]);
    setVerdicts([]);
    setSessionFilter(null);
  };

  const hasFilters =
    !!q || days !== 30 || eventTypes.length > 0 || verdicts.length > 0 || !!sessionFilter;

  return (
    <div id="page-audit" className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#111827] text-white flex items-center justify-center shadow-xs">
            <ScrollText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#111827] tracking-tight">
              Audit Trail{" "}
              <span className="text-[#9CA3AF] font-mono text-base font-normal">({entries.length})</span>
            </h1>
            <p className="text-sm text-[#6B7280] mt-0.5">
              Every state transition, rule gate, and monetary effect — recorded chronologically and tamper-evidently.
            </p>
          </div>
        </div>

        <span className="font-mono text-xs text-[#059669] bg-[#ECFDF5] border border-[#A7F3D0] px-3 py-1 rounded-full font-medium flex items-center gap-1.5 shadow-xs self-start">
          <ShieldCheck className="w-4 h-4" />
          SHA-256 chained
        </span>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-3 sm:p-4 shadow-xs flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setSessionFilter(null);
                setQ(e.target.value);
              }}
              placeholder="Search session / mandate id, narrative, payload…"
              className="w-full pl-8 pr-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-[#111827] focus:bg-white transition-colors"
            />
          </div>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 bg-white border border-[#E5E7EB] focus:border-[#111827] rounded-lg font-mono text-xs text-[#111827] outline-none cursor-pointer"
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-3 shrink-0">
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="font-mono text-xs text-[#2563EB] hover:underline cursor-pointer whitespace-nowrap"
              >
                Clear filters
              </button>
            )}
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-1.5 font-mono text-xs text-[#6B7280] hover:text-[#111827] cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
          <span className="text-[#9CA3AF] uppercase tracking-wider mr-1">Event</span>
          {EVENT_FILTERS.map((f) => {
            const on = eventTypes.includes(f.value);
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setEventTypes((prev) => toggle(prev, f.value))}
                className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                  on ? "bg-[#111827] text-white" : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          <span className="text-[#D1D5DB] mx-1">|</span>
          <span className="text-[#9CA3AF] uppercase tracking-wider mr-1">Verdict</span>
          {VERDICT_FILTERS.map((f) => {
            const on = verdicts.includes(f.value);
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setVerdicts((prev) => toggle(prev, f.value))}
                className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                  on ? "bg-[#111827] text-white" : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
                }`}
              >
                {f.label}
              </button>
            );
          })}
          {updatedAt && (
            <span className="ml-auto text-[#9CA3AF]">
              Updated {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>

        {sessionFilter && (
          <div className="flex items-center gap-2 text-[11px] font-mono text-[#6B7280] bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg px-2.5 py-1.5 flex-wrap">
            <Shield className="w-3 h-3 text-[#2563EB]" />
            Showing one session:{" "}
            <span className="text-[#111827] font-semibold">{sessionFilter.substring(0, 18)}…</span>
            {sessionVerified === true && (
              <span className="inline-flex items-center gap-1 text-[#059669] font-semibold">
                <ShieldCheck className="w-3 h-3" /> chain verified
              </span>
            )}
            {sessionVerified === false && (
              <span className="inline-flex items-center gap-1 text-[#DC2626] font-semibold">
                chain BROKEN — tampering detected
              </span>
            )}
            <button
              type="button"
              onClick={() => setSessionFilter(null)}
              className="ml-auto text-[#2563EB] hover:underline cursor-pointer"
            >
              show all
            </button>
          </div>
        )}
      </div>

      {/* Two-pane: list + detail */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Left: flat log list */}
        <div className="w-full lg:w-[46%] xl:w-[42%] shrink-0 bg-white border border-[#E5E7EB] rounded-2xl shadow-xs overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] gap-2 px-4 py-2.5 bg-[#FAFBFD] border-b border-[#E5E7EB] font-mono text-[10.5px] uppercase tracking-wider text-[#6B7280] font-semibold">
            <span>Timestamp · Event</span>
            <span className="text-right">Status</span>
          </div>

          <div className="max-h-[640px] overflow-y-auto divide-y divide-[#F3F4F6]">
            {error ? (
              <div className="p-6 text-center text-xs text-[#B91C1C] font-mono">{error}</div>
            ) : loading && entries.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#9CA3AF] font-mono flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : entries.length === 0 ? (
              <div className="p-8 text-center">
                <ScrollText className="w-8 h-8 text-[#D1D5DB] mx-auto mb-2" />
                <p className="text-xs font-semibold text-[#374151]">No audit entries</p>
                <p className="text-[11px] text-[#9CA3AF] mt-1">
                  {hasFilters ? "No events match these filters." : "Run a purchase to generate an audit trail."}
                </p>
              </div>
            ) : (
              entries.map((e) => {
                const meta = getAuditEventMeta(e.event_type);
                const isSel = e.entry_id === selectedId;
                const statusPill =
                  e.verdict === "approved" ? <Pill variant="green">Approved</Pill>
                  : e.verdict === "refused" ? <Pill variant="amber">Refused</Pill>
                  : e.verdict === "needs_human" ? <Pill variant="violet">Needs human</Pill>
                  : null;
                return (
                  <button
                    key={e.entry_id}
                    type="button"
                    onClick={() => setSelectedId(e.entry_id)}
                    className={`w-full text-left px-4 py-3 transition-colors flex flex-col gap-1.5 cursor-pointer ${
                      isSel ? "bg-[#F3F4F6] border-l-4 border-l-[#111827]" : "hover:bg-[#F9FAFB] border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-[#6B7280]">
                        {new Date(e.ts).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      {statusPill}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill variant={meta.colorVariant as any}>{meta.label}</Pill>
                      {e.amount_paise != null && (
                        <span className="font-mono text-xs font-bold text-[#111827] tabular-nums">
                          {paiseToRupees(e.amount_paise)}
                        </span>
                      )}
                    </div>
                    {e.narrative && (
                      <p className="text-xs text-[#6B7280] line-clamp-1">{e.narrative}</p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: selected entry detail */}
        <div className="flex-1 w-full min-w-0">
          <AuditEntryDetail entry={selected} onFilterSession={setSessionFilter} />
        </div>
      </div>
    </div>
  );
};
