import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Mandate } from "../../lib/types";
import { Pill } from "../shared/Pill";
import { Button } from "../shared/Button";
import { CopyButton } from "../shared/CopyButton";
import { SpendMeter } from "../layout/SpendMeter";
import { paiseToRupeesPlain } from "../../lib/money";
import { ExternalLink, ShieldAlert, ArrowRight } from "lucide-react";

interface MandateCardProps {
  mandate: Mandate;
  isActive: boolean;
  onSelect: (mandate: Mandate) => void;
  onRevoke: (mandateId: string) => Promise<boolean>;
  id?: string;
}

export const MandateCard: React.FC<MandateCardProps> = ({
  mandate,
  isActive,
  onSelect,
  onRevoke,
  id,
}) => {
  const [revoking, setRevoking] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const handleRevoke = async () => {
    setRevoking(true);
    await onRevoke(mandate.mandate_id);
    setRevoking(false);
    setShowRevokeConfirm(false);
  };

  const isRevoked = !!mandate.revoked || mandate.session_state === "REVOKED";
  const nowUnix = Math.floor(Date.now() / 1000);
  const isExpired = !isRevoked && !!mandate.ttl_unix && mandate.ttl_unix < nowUnix;
  const isDepleted = !isRevoked && !isExpired && (mandate.running_spend_paise || 0) >= mandate.budget_total_paise;
  const isHealthyActive = !isRevoked && !isExpired && !isDepleted;

  // Format expiry status text
  const getExpiryDisplay = () => {
    if (!mandate.ttl_unix) return null;
    const diffSec = mandate.ttl_unix - nowUnix;
    if (diffSec < 0) {
      const hoursAgo = Math.max(1, Math.round(Math.abs(diffSec) / 3600));
      return `Expired ${hoursAgo}h ago`;
    }
    const hoursLeft = Math.round(diffSec / 3600);
    if (hoursLeft > 24) {
      return `Expires in ${Math.round(hoursLeft / 24)}d`;
    }
    return `Expires in ${hoursLeft}h`;
  };

  const expiryText = getExpiryDisplay();

  return (
    <div
      id={id}
      className={`bg-white border rounded-xl p-5 sm:p-6 transition-all shadow-xs ${
        isActive
          ? "border-[#111827] ring-1 ring-[#111827]"
          : "border-[#E5E7EB] hover:border-[#D1D5DB]"
      }`}
    >
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E7EB]">
        <div className="flex items-center flex-wrap gap-2.5">
          <h3 className="text-[15px] font-bold text-[#111827]">
            {mandate.nl_goal || "Authorized Shopping Mandate"}
          </h3>

          {isRevoked ? (
            <Pill variant="rust">Revoked</Pill>
          ) : isExpired ? (
            <Pill variant="amber">Expired</Pill>
          ) : isDepleted ? (
            <Pill variant="violet">Depleted</Pill>
          ) : (
            <Pill variant="green">Authorized</Pill>
          )}

          {isActive && isHealthyActive && (
            <span className="font-mono text-[10px] uppercase tracking-wider bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0] font-bold px-2 py-0.5 rounded-full">
              Active Console
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {isHealthyActive ? (
            !showRevokeConfirm ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRevokeConfirm(true)}
                className="text-xs"
                title="Instant cryptographic kill-switch"
              >
                Revoke
              </Button>
            ) : (
              <div className="flex items-center gap-1.5 animate-fadeIn">
                <span className="text-xs text-[#DC2626] font-mono font-medium mr-1 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Kill-switch?
                </span>
                <Button
                  variant="solid"
                  size="sm"
                  loading={revoking}
                  onClick={handleRevoke}
                  className="bg-[#DC2626] hover:bg-[#B91C1C] border-[#DC2626] text-xs px-2.5 py-1"
                >
                  Confirm Revoke
                </Button>
                <button
                  type="button"
                  onClick={() => setShowRevokeConfirm(false)}
                  className="text-xs font-mono text-[#6B7280] hover:text-[#111827] px-1.5 py-1"
                >
                  Cancel
                </button>
              </div>
            )
          ) : (
            <span className="font-mono text-xs text-[#9CA3AF] italic">
              {isRevoked ? "Revoked" : isExpired ? "Expired" : isDepleted ? "Budget Exhausted" : "Inactive"}
            </span>
          )}

          {!isActive && isHealthyActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSelect(mandate)}
              className="text-xs"
            >
              Select
            </Button>
          )}
        </div>
      </div>

      {/* Spend Meter & Details */}
      <div className="mt-4 space-y-3">
        <SpendMeter
          usedPaise={mandate.running_spend_paise || 0}
          totalPaise={mandate.budget_total_paise}
        />

        {/* Technical Bounds Meta */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 text-xs font-mono text-[#6B7280] bg-[#F9FAFB] p-3 rounded-lg border border-[#E5E7EB]">
          <div>
            <span className="text-[#9CA3AF] block text-[10.5px] uppercase">Per-Txn Cap</span>
            <span className="font-semibold text-[#111827]">
              {paiseToRupeesPlain(mandate.per_txn_cap_paise)}
            </span>
          </div>

          <div>
            <span className="text-[#9CA3AF] block text-[10.5px] uppercase">Categories</span>
            <span className="text-[#111827] truncate block" title={mandate.allowed_categories.join(", ")}>
              {mandate.allowed_categories.slice(0, 2).join(", ")}
              {mandate.allowed_categories.length > 2 ? ` +${mandate.allowed_categories.length - 2}` : ""}
            </span>
          </div>

          <div>
            <span className="text-[#9CA3AF] block text-[10.5px] uppercase">Validity / TTL</span>
            <span className={`font-semibold ${isExpired ? "text-[#D97706]" : "text-[#111827]"}`}>
              {expiryText || "Active"}
            </span>
          </div>

          <div>
            <span className="text-[#9CA3AF] block text-[10.5px] uppercase">Mandate ID</span>
            <span className="flex items-center gap-1 text-[#2563EB] font-mono">
              <span className="truncate" title={mandate.mandate_id}>
                {mandate.mandate_id.substring(0, 14)}...
              </span>
              <CopyButton value={mandate.mandate_id} label="mandate ID" />
            </span>
          </div>
        </div>

        {/* Audit link & Shop link */}
        <div className="flex items-center justify-between pt-1 text-xs">
          {mandate.session_id ? (
            <Link
              to={`/audit/${mandate.session_id}`}
              className="inline-flex items-center gap-1 font-mono text-[#2563EB] hover:underline"
            >
              <span>View Audit Ledger</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          ) : (
            <span />
          )}

          {isHealthyActive && (
            <Link
              to="/shop"
              onClick={() => onSelect(mandate)}
              className="inline-flex items-center gap-1 font-medium text-[#111827] hover:text-[#2563EB] transition-colors"
            >
              <span>Shop with this mandate</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
