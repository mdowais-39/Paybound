import React, { useState, useEffect } from "react";
import { AuditLogEntry, AuditEntryContext } from "../../lib/types";
import { getAuditEntryContext } from "../../lib/api";
import { getAuditEventMeta } from "../../lib/verdictMeta";
import { paiseToRupees } from "../../lib/money";
import { Pill } from "../shared/Pill";
import { CopyButton } from "../shared/CopyButton";
import {
  ShieldCheck,
  Shield,
  ArrowRight,
  FileText,
  ScrollText,
  Filter,
  Package,
} from "lucide-react";

interface AuditEntryDetailProps {
  entry: AuditLogEntry | null;
  /** Filter the whole log down to this entry's session (stays in the two-pane view). */
  onFilterSession?: (sessionId: string) => void;
}

const truncateHash = (hash: string | null) => {
  if (!hash) return "GENESIS (null)";
  return hash.length <= 16 ? hash : `${hash.substring(0, 8)}…${hash.substring(hash.length - 8)}`;
};

const verdictVariant = (v: string | null): "green" | "amber" | "violet" | "slate" => {
  if (v === "approved") return "green";
  if (v === "refused") return "amber";
  if (v === "needs_human") return "violet";
  return "slate";
};

/** The right detail pane of the two-pane audit viewer — the full context of one
 * selected entry: what happened (summary + narrative), the tamper-evidence link
 * (hash chain), and under whose authority it happened (mandate context, fetched
 * on demand). Every value is real backend data; nothing is fabricated. */
export const AuditEntryDetail: React.FC<AuditEntryDetailProps> = ({ entry, onFilterSession }) => {
  const [ctx, setCtx] = useState<AuditEntryContext | null>(null);
  const [ctxError, setCtxError] = useState(false);

  useEffect(() => {
    setCtx(null);
    setCtxError(false);
    if (!entry) return;
    let cancelled = false;
    getAuditEntryContext(entry.entry_id)
      .then((c) => !cancelled && setCtx(c))
      .catch(() => !cancelled && setCtxError(true));
    return () => {
      cancelled = true;
    };
  }, [entry?.entry_id]);

  if (!entry) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 flex flex-col items-center justify-center text-center shadow-xs h-full min-h-[420px]">
        <div className="w-12 h-12 rounded-xl bg-[#F3F4F6] border border-[#E5E7EB] flex items-center justify-center text-[#6B7280] mb-3">
          <ScrollText className="w-6 h-6" />
        </div>
        <p className="text-sm font-semibold text-[#111827]">Select an event</p>
        <p className="text-xs text-[#6B7280] mt-1 max-w-[240px]">
          Pick any entry from the log to inspect its narrative, hash-chain link, and the mandate authority behind it.
        </p>
      </div>
    );
  }

  const meta = getAuditEventMeta(entry.event_type);

  const Section: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode }> = ({
    title,
    icon,
    children,
  }) => (
    <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xs overflow-hidden">
      <div className="px-4 py-2.5 bg-[#FAFBFD] border-b border-[#E5E7EB] flex items-center gap-1.5">
        {icon}
        <span className="font-mono text-[11px] uppercase tracking-wider text-[#6B7280] font-semibold">
          {title}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );

  // `cart_built` and `gate_decision` payloads carry a `line_items` array
  // (real catalog data: title/category/qty/price_paise) — present only on
  // those two event types, so this is undefined for everything else.
  const lineItems = Array.isArray((entry.payload as any)?.line_items)
    ? ((entry.payload as any).line_items as Array<{
        item_id?: string;
        title?: string | null;
        category?: string;
        qty?: number;
        price_paise?: number;
      }>)
    : null;

  const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-[#6B7280]">{label}</span>
      <span className="text-[#111827] font-medium text-right min-w-0 break-words">{children}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <Section title="Summary">
        <div className="flex flex-col gap-1.5">
          <Row label="Event">
            <Pill variant={meta.colorVariant as any}>{meta.label}</Pill>
          </Row>
          {entry.verdict && (
            <Row label="Verdict">
              <Pill variant={verdictVariant(entry.verdict)}>{entry.verdict}</Pill>
            </Row>
          )}
          {entry.rule_cited && (
            <Row label="Rule cited">
              <span className="font-mono text-xs text-[#C2410C]">{entry.rule_cited}</span>
            </Row>
          )}
          {entry.amount_paise != null && (
            <Row label="Amount">
              <span className="font-mono tabular-nums">{paiseToRupees(entry.amount_paise)}</span>
            </Row>
          )}
          <Row label="Sequence">
            <span className="font-mono text-xs">#{entry.seq}</span>
          </Row>
          <Row label="Timestamp">
            <span className="font-mono text-xs">
              {new Date(entry.ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" })}
            </span>
          </Row>
          <Row label="Session">
            <span className="inline-flex items-center gap-1">
              {onFilterSession ? (
                <button
                  type="button"
                  onClick={() => onFilterSession(entry.session_id)}
                  className="font-mono text-xs text-[#2563EB] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  title="Show only this session's events"
                >
                  {entry.session_id.substring(0, 12)}… <Filter className="w-3 h-3" />
                </button>
              ) : (
                <span className="font-mono text-xs">{entry.session_id.substring(0, 12)}…</span>
              )}
              <CopyButton value={entry.session_id} label="session ID" />
            </span>
          </Row>
        </div>
      </Section>

      {/* Narrative — the plain-English explanation (our differentiator) */}
      <Section title="What happened" icon={<FileText className="w-3.5 h-3.5 text-[#2563EB]" />}>
        {entry.narrative ? (
          <p className="text-sm leading-relaxed text-[#111827]">{entry.narrative}</p>
        ) : (
          <p className="text-xs text-[#9CA3AF] italic font-mono">
            Narrative is being generated in the background — it will appear here shortly.
          </p>
        )}
      </Section>

      {/* Products — real catalog detail (title/category/price), not just a
          total, on the two event types that actually carry it. */}
      {lineItems && lineItems.length > 0 && (
        <Section title="Products" icon={<Package className="w-3.5 h-3.5 text-[#7C3AED]" />}>
          <div className="flex flex-col divide-y divide-[#F3F4F6]">
            {lineItems.map((li, i) => (
              <div
                key={li.item_id ?? i}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-[#111827] font-medium truncate">
                    {li.title || "(item)"}
                  </p>
                  <p className="text-[11px] font-mono text-[#6B7280] mt-0.5">
                    {li.category ?? "—"}
                    {li.qty != null && li.qty !== 1 ? ` · qty ${li.qty}` : ""}
                  </p>
                </div>
                {li.price_paise != null && (
                  <span className="font-mono text-xs tabular-nums text-[#111827] shrink-0">
                    {paiseToRupees(li.price_paise)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Hash-chain link — the tamper-evidence mechanism */}
      <Section title="Hash-chain link" icon={<ShieldCheck className="w-3.5 h-3.5 text-[#059669]" />}>
        <div className="flex items-center flex-wrap gap-2 text-[11px] font-mono text-[#6B7280]">
          <span className="text-[#9CA3AF]">prev</span>
          <span title={entry.prev_hash || "Genesis"}>{truncateHash(entry.prev_hash)}</span>
          <ArrowRight className="w-3 h-3 text-[#9CA3AF]" />
          <span className="text-[#9CA3AF]">this</span>
          <span className="font-semibold text-[#111827]" title={entry.this_hash}>
            {truncateHash(entry.this_hash)}
          </span>
          <CopyButton value={entry.this_hash} label="this_hash" className="ml-auto" />
        </div>
        <p className="text-[11px] text-[#9CA3AF] mt-2">
          Each entry's hash folds in the previous entry's — altering any past record breaks every link after it.
        </p>
      </Section>

      {/* Mandate authority — under whose bounds did this happen */}
      <Section title="Mandate authority" icon={<Shield className="w-3.5 h-3.5 text-[#7C3AED]" />}>
        {ctxError ? (
          <p className="text-xs text-[#9CA3AF] font-mono">Could not load the mandate context.</p>
        ) : !ctx ? (
          <p className="text-xs text-[#9CA3AF] font-mono">Loading…</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Row label="Mandate">
              <span className="inline-flex items-center gap-1 font-mono text-xs" title={ctx.mandate_id}>
                {ctx.mandate_id.substring(0, 12)}…
                <CopyButton value={ctx.mandate_id} label="mandate ID" />
              </span>
            </Row>
            <Row label="Payer">
              <span className="font-mono text-xs">{ctx.payer}</span>
            </Row>
            <Row label="Goal">
              <span className="text-sm">“{ctx.nl_goal}”</span>
            </Row>
            <Row label="Budget">
              <span className="font-mono tabular-nums">{paiseToRupees(ctx.budget_total_paise)}</span>
            </Row>
            <Row label="Per-txn cap">
              <span className="font-mono tabular-nums">{paiseToRupees(ctx.per_txn_cap_paise)}</span>
            </Row>
            <Row label="Categories">
              <span className="text-xs">
                {ctx.allowed_categories.length ? ctx.allowed_categories.join(", ") : "Any (unrestricted)"}
              </span>
            </Row>
            <Row label="Merchants">
              <span className="text-xs">
                {ctx.allowed_merchants.length ? `${ctx.allowed_merchants.length} allowed` : "Whole marketplace"}
              </span>
            </Row>
            <Row label="Expires">
              <span className="font-mono text-xs">
                {new Date(ctx.ttl_unix * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </Row>
            {ctx.revoked && (
              <Row label="Status">
                <Pill variant="amber">Revoked</Pill>
              </Row>
            )}
          </div>
        )}
      </Section>

      {/* Raw payload */}
      <Section title="Raw payload">
        <div className="p-3 bg-[#111827] text-[#F9FAFB] rounded-lg font-mono text-[11.5px] overflow-x-auto max-h-72 leading-relaxed">
          <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
        </div>
      </Section>
    </div>
  );
};
