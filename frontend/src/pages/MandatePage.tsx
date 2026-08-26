import React, { useState, useMemo } from "react";
import { useMandate } from "../context/MandateContext";
import { MandateForm } from "../components/mandate/MandateForm";
import { AuthorityPreview } from "../components/mandate/AuthorityPreview";
import { MandateCard } from "../components/mandate/MandateCard";
import { createMandate } from "../lib/api";
import { Mandate } from "../lib/types";
import {
  ShieldCheck,
  Plus,
  CheckCircle2,
  Shield,
  Layers,
  Activity,
  ShieldAlert,
  Clock,
  Coins,
} from "lucide-react";

type MandateFilterCategory = "all" | "active" | "revoked" | "expired" | "depleted";

export const MandatePage: React.FC = () => {
  const { mandates, activeMandate, setActiveMandate, refreshMandates, revoke } = useMandate();

  const [formState, setFormState] = useState({
    budgetPaise: 1000000,
    capPaise: 600000,
    categories: ["footwear", "sports apparel"],
    merchantName: "Demo Store",
    expiryLabel: "in 24 hours",
    goal: "Authorized sports and apparel agent",
  });

  const [creating, setCreating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<MandateFilterCategory>("all");

  const handleFormSubmit = async (formData: any) => {
    setCreating(true);
    try {
      const created = await createMandate(formData);
      await refreshMandates();
      setActiveMandate(created);
      setSuccessMessage(`Mandate signed successfully: ${created.mandate_id.substring(0, 16)}...`);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  // Helper to determine status category of a mandate
  const getMandateCategory = (m: Mandate): "active" | "revoked" | "expired" | "depleted" => {
    const isRevoked = !!m.revoked || m.session_state === "REVOKED";
    if (isRevoked) return "revoked";
    const nowUnix = Math.floor(Date.now() / 1000);
    const isExpired = !!m.ttl_unix && m.ttl_unix < nowUnix;
    if (isExpired) return "expired";
    const isDepleted = (m.running_spend_paise || 0) >= m.budget_total_paise;
    if (isDepleted) return "depleted";
    return "active";
  };

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = {
      all: mandates.length,
      active: 0,
      revoked: 0,
      expired: 0,
      depleted: 0,
    };
    mandates.forEach((m) => {
      const cat = getMandateCategory(m);
      counts[cat]++;
    });
    return counts;
  }, [mandates]);

  // Filtered mandates according to active category tab
  const filteredMandates = useMemo(() => {
    if (selectedFilter === "all") return mandates;
    return mandates.filter((m) => getMandateCategory(m) === selectedFilter);
  }, [mandates, selectedFilter]);

  const CATEGORY_TABS: {
    id: MandateFilterCategory;
    label: string;
    icon: React.ElementType;
    dotColor?: string;
  }[] = [
    { id: "all", label: "All Mandates", icon: Layers },
    { id: "active", label: "Active", icon: Activity, dotColor: "bg-[#059669]" },
    { id: "revoked", label: "Revoked", icon: ShieldAlert, dotColor: "bg-[#DC2626]" },
    { id: "expired", label: "Expired", icon: Clock, dotColor: "bg-[#D97706]" },
    { id: "depleted", label: "Depleted", icon: Coins, dotColor: "bg-[#7C3AED]" },
  ];

  return (
    <div id="page-mandate" className="flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#111827] tracking-tight">
            Consent & Mandate Console
          </h1>
          <p className="text-sm text-[#6B7280] mt-0.5">
            Grant and control bounded spending authority. The deterministic kernel guarantees these limits.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[#059669] bg-[#ECFDF5] border border-[#A7F3D0] px-3 py-1 rounded-full font-medium flex items-center gap-1.5 shadow-xs">
            <ShieldCheck className="w-4 h-4" />
            Ed25519 Signed
          </span>
        </div>
      </div>

      {/* Success Notification Banner */}
      {successMessage && (
        <div className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] p-3.5 rounded-xl flex items-center gap-2 font-mono text-xs shadow-xs animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#059669]" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Two-Column Layout: Left (Form) & Right (Authority Preview) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column — New Mandate Form (7 cols) */}
        <div className="lg:col-span-7">
          <MandateForm
            onFormStateChange={setFormState}
            onSubmit={handleFormSubmit}
            loading={creating}
          />
        </div>

        {/* Right Column — Live Authority Preview Card (5 cols) */}
        <div className="lg:col-span-5 h-full">
          <AuthorityPreview
            id="authority-preview-card"
            budgetPaise={formState.budgetPaise}
            capPaise={formState.capPaise}
            categories={formState.categories}
            merchantName={formState.merchantName}
            expiryLabel={formState.expiryLabel}
          />
        </div>
      </div>

      {/* Below Both Columns — Delegated Mandates Grouped by Category */}
      <div className="flex flex-col gap-4 mt-2">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[#E5E7EB] gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#F3F4F6] border border-[#E5E7EB] flex items-center justify-center text-[#111827] shrink-0">
              <Shield className="w-4 h-4 text-[#111827]" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#111827] tracking-tight uppercase font-mono flex items-center gap-2">
                <span>Delegated Spending Mandates</span>
              </h2>
              <p className="text-xs sm:text-[13px] text-[#4B5563] mt-0.5">
                Authorized agents and their real-time cryptographic spending envelopes.
              </p>
            </div>
          </div>
          <span className="font-mono text-xs font-semibold text-[#111827] bg-[#F3F4F6] px-3 py-1 rounded-full border border-[#E5E7EB] shadow-2xs self-start sm:self-auto">
            {mandates.length} Total {mandates.length === 1 ? "Mandate" : "Mandates"}
          </span>
        </div>

        {/* Category Filter Tabs Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORY_TABS.map((tab) => {
            const Icon = tab.icon;
            const isSelected = selectedFilter === tab.id;
            const count = categoryCounts[tab.id];

            return (
              <button
                key={tab.id}
                type="button"
                id={`btn-mandate-filter-${tab.id}`}
                onClick={() => setSelectedFilter(tab.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer whitespace-nowrap shadow-2xs border ${
                  isSelected
                    ? "bg-[#111827] text-white border-[#111827] shadow-sm"
                    : "bg-white text-[#4B5563] hover:text-[#111827] hover:bg-[#F9FAFB] border-[#E5E7EB]"
                }`}
              >
                {tab.dotColor ? (
                  <span className={`w-2 h-2 rounded-full shrink-0 ${tab.dotColor}`} />
                ) : (
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-white" : "text-[#6B7280]"}`} />
                )}
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    isSelected
                      ? "bg-white/20 text-white"
                      : "bg-[#F3F4F6] text-[#6B7280]"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Mandate Cards Grid or Category Empty State */}
        {filteredMandates.length === 0 ? (
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-8 text-center shadow-xs flex flex-col items-center justify-center gap-2">
            <p className="font-mono text-xs text-[#6B7280]">
              {selectedFilter === "all"
                ? "No spending mandates active. Use the form above to grant your first authority."
                : `No mandates found in the "${CATEGORY_TABS.find((t) => t.id === selectedFilter)?.label}" category.`}
            </p>
            {selectedFilter !== "all" && (
              <button
                type="button"
                onClick={() => setSelectedFilter("all")}
                className="mt-2 text-xs font-mono text-[#2563EB] hover:underline font-semibold cursor-pointer"
              >
                ← View All Mandates ({categoryCounts.all})
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredMandates.map((m) => (
              <MandateCard
                key={m.mandate_id}
                mandate={m}
                isActive={activeMandate?.mandate_id === m.mandate_id}
                onSelect={(selected) => setActiveMandate(selected)}
                onRevoke={revoke}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
