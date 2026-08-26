import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMandate } from "../context/MandateContext";
import { AuditTimeline } from "../components/audit/AuditTimeline";
import { getAuditChain } from "../lib/api";
import { AuditChain } from "../lib/types";
import { ScrollText, ShieldCheck, AlertTriangle } from "lucide-react";

// The Audit Trail Viewer — the real, hash-chained, tamper-evident ledger for a
// session, straight from GET /sessions/{id}/audit. Every hash, narrative, and
// the verify_chain() verdict come from the backend; nothing here is fabricated.
export const AuditPage: React.FC = () => {
  const { sessionId: paramSessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { mandates, activeMandate } = useMandate();

  const [chain, setChain] = useState<AuditChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sessions the user owns (each mandate has one bound session).
  const sessions = mandates
    .filter((m) => m.session_id)
    .map((m) => ({ sessionId: m.session_id as string, label: m.nl_goal || m.mandate_id, mandateId: m.mandate_id }));

  const sessionId =
    paramSessionId || activeMandate?.session_id || sessions[0]?.sessionId || null;

  const load = useCallback(async () => {
    if (!sessionId) {
      setChain(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setChain(await getAuditChain(sessionId));
    } catch (e: any) {
      setError(e?.message || "Failed to load the audit chain.");
      setChain(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div id="page-audit" className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#111827] text-white flex items-center justify-center shadow-xs">
            <ScrollText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#111827] tracking-tight">
              Audit Trail
            </h1>
            <p className="text-sm text-[#6B7280] mt-0.5">
              The tamper-evident, hash-chained record of exactly why every rupee moved — and under whose authority.
            </p>
          </div>
        </div>

        <span className="font-mono text-xs text-[#059669] bg-[#ECFDF5] border border-[#A7F3D0] px-3 py-1 rounded-full font-medium flex items-center gap-1.5 shadow-xs self-start">
          <ShieldCheck className="w-4 h-4" />
          SHA-256 chained
        </span>
      </div>

      {/* Session selector */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <label htmlFor="audit-session-select" className="font-mono text-xs text-[#6B7280] font-semibold uppercase tracking-wider">
            Session
          </label>
          <select
            id="audit-session-select"
            value={sessionId ?? ""}
            onChange={(e) => navigate(`/audit/${e.target.value}`)}
            className="px-3 py-2 bg-white border border-[#E5E7EB] focus:border-[#111827] rounded-lg font-mono text-xs text-[#111827] outline-none cursor-pointer max-w-full"
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId.substring(0, 18)}… — {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Body */}
      {!sessionId ? (
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center shadow-xs">
          <p className="font-mono text-xs text-[#6B7280]">
            No session yet. Create a mandate and run a purchase to generate an audit trail.
          </p>
        </div>
      ) : error ? (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-5 flex items-start gap-2.5 shadow-xs">
          <AlertTriangle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#991B1B]">Couldn't load the audit chain</p>
            <p className="text-xs text-[#B91C1C] font-mono mt-0.5 break-words">{error}</p>
          </div>
        </div>
      ) : (
        <AuditTimeline chain={chain} loading={loading} onRefresh={load} />
      )}
    </div>
  );
};
