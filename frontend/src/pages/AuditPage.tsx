import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import { getAuditLog } from "../lib/api";
import { AuditLogEntry, AuditEventType, Verdict } from "../lib/types";
import { paiseToRupees } from "../lib/money";
import { Pill } from "../components/shared/Pill";
import { AuditSessionPanel } from "../components/audit/AuditSessionPanel";
import {
  ScrollText,
  ShieldCheck,
  Search,
  RefreshCw,
  Loader2,
  Layers,
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

const VERDICT_FILTERS: { value: Verdict; label: string }[] = [
  { value: "approved", label: "Approved" },
  { value: "refused", label: "Refused" },
  { value: "needs_human", label: "Needs human" },
];

const DAY_OPTIONS = [
  { value: 0, label: "All time" },
  { value: 1, label: "Last 24h" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
];

const verdictVariant = (v: string | null): "green" | "amber" | "violet" | "slate" => {
  if (v === "approved") return "green";
  if (v === "refused") return "amber";
  if (v === "needs_human") return "violet";
  return "slate";
};

/** One row in the left list — a "cart", i.e. every audit entry that shares a
 * session_id, summarised into a single scannable card instead of leaving each
 * of its stages scattered as separate rows. Derived client-side from the
 * (filtered) flat entry list. */
interface SessionGroup {
  sessionId: string;
  latestTs: string;
  title: string;
  verdict: Verdict | null;
  amountPaise: number | null;
  eventCount: number;
}

// The mandate's nl_goal defaults to this generic placeholder whenever a
// mandate is created without one — real, but not identifying. Prefer a
// cart/gate/payment narrative (built from the actual items and amounts) for
// the group title, and only fall back to nl_goal when it's a genuine
// human-typed goal.
const GENERIC_NL_GOAL = "shop within budget";

function groupBySession(entries: AuditLogEntry[]): SessionGroup[] {
  const bySession = new Map<string, AuditLogEntry[]>();
  for (const e of entries) {
    const arr = bySession.get(e.session_id);
    if (arr) arr.push(e);
    else bySession.set(e.session_id, [e]);
  }
  const groups: SessionGroup[] = [];
  for (const [sessionId, rows] of bySession) {
    // `entries` arrives newest-first, so within each group rows[0] is the most
    // recent matching entry and rows[rows.length - 1] the earliest.
    const withVerdict = rows.find((r) => r.verdict);
    const created = rows.find((r) => r.event_type === "session_created");
    const goal = (created?.payload as any)?.nl_goal as string | undefined;
    const identifying = rows.find(
      (r) => (r.event_type === "cart_built" || r.event_type === "gate_decision" || r.event_type === "payment_effect") && r.narrative,
    )?.narrative;
    const title =
      identifying
        ?? (goal && goal !== GENERIC_NL_GOAL ? `"${goal}"` : undefined)
        ?? rows[rows.length - 1]?.narrative
        ?? `Session ${sessionId.slice(0, 10)}…`;
    groups.push({
      sessionId,
      latestTs: rows[0].ts,
      title,
      verdict: (withVerdict?.verdict as Verdict | undefined) ?? null,
      amountPaise: withVerdict?.amount_paise ?? rows.find((r) => r.amount_paise != null)?.amount_paise ?? null,
      eventCount: rows.length,
    });
  }
  return groups.sort((a, b) => Date.parse(b.latestTs) - Date.parse(a.latestTs));
}

/** The Audit Trail Viewer — every state transition, rule gate, and monetary
 * effect, grouped by CART (session) so one purchase's whole story reads as one
 * card instead of its stages being scattered across a flat stream. The left
 * list is filterable/searchable across every cart; selecting one shows its
 * full stage-by-stage story on the right. Every value is real backend data
 * from GET /audit; nothing here is fabricated. */
export const AuditPage: React.FC = () => {
  const { sessionId: paramSessionId } = useParams<{ sessionId: string }>();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(paramSessionId ?? null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [days, setDays] = useState(30);
  const [eventTypes, setEventTypes] = useState<AuditEventType[]>([]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getAuditLog({
        q: q.trim() || undefined,
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
  }, [q, days, eventTypes, verdicts]);

  // Debounced reload on any filter change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load]);

  const groups = useMemo(() => groupBySession(entries), [entries]);

  // Keep a valid selection: default to the most recent cart, clear if the
  // current one no longer matches the active filters. A deep-linked session
  // (from "View in Audit Ledger") is respected even if it's not in the
  // CURRENT filtered list — it still loads on the right via its own fetch.
  useEffect(() => {
    if (groups.length === 0) {
      if (!paramSessionId) setSelectedSessionId(null);
      return;
    }
    if (!selectedSessionId || (!paramSessionId && !groups.some((g) => g.sessionId === selectedSessionId))) {
      setSelectedSessionId(groups[0].sessionId);
    }
  }, [groups]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const clearFilters = () => {
    setQ("");
    setDays(30);
    setEventTypes([]);
    setVerdicts([]);
  };

  const hasFilters = !!q || days !== 30 || eventTypes.length > 0 || verdicts.length > 0;

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
              <span className="text-[#9CA3AF] font-mono text-base font-normal">({groups.length})</span>
            </h1>
            <p className="text-sm text-[#6B7280] mt-0.5">
              One card per cart — every stage of a purchase, in order, tamper-evidently recorded.
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
              onChange={(e) => setQ(e.target.value)}
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

        {/* Filter chips — narrow which CARTS appear (a cart matches if any of
            its stages match). */}
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
          <span className="text-[#9CA3AF] uppercase tracking-wider mr-1">Stage had</span>
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
          <span className="text-[#9CA3AF] uppercase tracking-wider mr-1">Outcome</span>
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
      </div>

      {/* Two-pane: cart list + full story */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Left: one card per cart */}
        <div className="w-full lg:w-[40%] xl:w-[36%] shrink-0 bg-white border border-[#E5E7EB] rounded-2xl shadow-xs overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2.5 bg-[#FAFBFD] border-b border-[#E5E7EB] font-mono text-[10.5px] uppercase tracking-wider text-[#6B7280] font-semibold">
            <Layers className="w-3 h-3" />
            <span>Carts</span>
          </div>

          <div className="max-h-[640px] overflow-y-auto divide-y divide-[#F3F4F6]">
            {error ? (
              <div className="p-6 text-center text-xs text-[#B91C1C] font-mono">{error}</div>
            ) : loading && groups.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#9CA3AF] font-mono flex items-center justify-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
              </div>
            ) : groups.length === 0 ? (
              <div className="p-8 text-center">
                <ScrollText className="w-8 h-8 text-[#D1D5DB] mx-auto mb-2" />
                <p className="text-xs font-semibold text-[#374151]">No carts found</p>
                <p className="text-[11px] text-[#9CA3AF] mt-1">
                  {hasFilters ? "No carts match these filters." : "Run a purchase to generate an audit trail."}
                </p>
              </div>
            ) : (
              groups.map((g) => {
                const isSel = g.sessionId === selectedSessionId;
                return (
                  <button
                    key={g.sessionId}
                    type="button"
                    onClick={() => setSelectedSessionId(g.sessionId)}
                    className={`w-full text-left px-4 py-3 transition-colors flex flex-col gap-1.5 cursor-pointer ${
                      isSel ? "bg-[#F3F4F6] border-l-4 border-l-[#111827]" : "hover:bg-[#F9FAFB] border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-[#6B7280]">
                        {new Date(g.latestTs).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {g.verdict && <Pill variant={verdictVariant(g.verdict)}>{g.verdict}</Pill>}
                    </div>
                    <p className="text-sm font-semibold text-[#111827] line-clamp-1">{g.title}</p>
                    <div className="flex items-center justify-between text-xs">
                      {g.amountPaise != null ? (
                        <span className="font-mono font-bold text-[#111827] tabular-nums">
                          {paiseToRupees(g.amountPaise)}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="font-mono text-[10.5px] text-[#9CA3AF]">
                        {g.eventCount} {g.eventCount === 1 ? "stage" : "stages"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: the selected cart's full story */}
        <div className="flex-1 w-full min-w-0">
          <AuditSessionPanel sessionId={selectedSessionId} />
        </div>
      </div>
    </div>
  );
};
