import React from "react";
import { CheckCircle, AlertOctagon, ShieldCheck, Copy, Check } from "lucide-react";
import { useState } from "react";

interface VerifyBadgeProps {
  verified: boolean;
  sessionId: string;
  entryCount: number;
  id?: string;
}

export const VerifyBadge: React.FC<VerifyBadgeProps> = ({
  verified,
  sessionId,
  entryCount,
  id,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      id={id}
      className={`w-full rounded-xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs ${
        verified
          ? "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]"
          : "bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]"
      }`}
    >
      {/* Left Status Text */}
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 shadow-xs ${
            verified ? "bg-[#059669] text-white" : "bg-[#DC2626] text-white"
          }`}
        >
          {verified ? (
            <ShieldCheck className="w-6 h-6" />
          ) : (
            <AlertOctagon className="w-6 h-6" />
          )}
        </div>

        <div>
          <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
            <span>
              {verified
                ? "✓ Verified — Cryptographic Chain Intact"
                : "✗ TAMPER DETECTED — Audit Chain Broken"}
            </span>
          </h2>
          <p className="text-xs font-mono text-[#6B7280] mt-0.5">
            SHA-256 hash-chain verified across {entryCount} immutable sequence entries.
          </p>
        </div>
      </div>

      {/* Right Session ID in Monospace */}
      <div className="flex items-center gap-2 font-mono text-xs bg-white px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#111827] shadow-xs">
        <span className="text-[#9CA3AF]">session:</span>
        <span className="font-semibold">{sessionId}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[#6B7280] hover:text-[#111827] transition-colors cursor-pointer p-0.5"
          title="Copy Session ID"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-[#059669]" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
