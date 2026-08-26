import React, { useState, useEffect } from "react";
import { CategoryMultiSelect } from "./CategoryMultiSelect";
import { Button } from "../shared/Button";
import { rupeesToPaise, paiseToRupeesPlain } from "../../lib/money";
import { getCategories } from "../../lib/api";
import { ShieldCheck } from "lucide-react";

interface MandateFormProps {
  onFormStateChange: (state: {
    budgetPaise: number;
    capPaise: number;
    categories: string[];
    merchantName: string;
    expiryLabel: string;
    goal: string;
  }) => void;
  onSubmit: (formData: {
    budget_total_paise: number;
    per_txn_cap_paise: number;
    allowed_categories: string[];
    merchant_id: string | null;
    ttl_seconds: number;
    nl_goal: string;
  }) => Promise<void>;
  loading?: boolean;
}

export const MandateForm: React.FC<MandateFormProps> = ({
  onFormStateChange,
  onSubmit,
  loading = false,
}) => {
  // Form State in Rupees (strings for pleasant input typing)
  const [budgetRupees, setBudgetRupees] = useState("10000");
  const [capRupees, setCapRupees] = useState("6000");
  // Empty = authorize every category the merchant sells (the backend's
  // default when allowed_categories is omitted). The user optionally narrows.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [ttlHours, setTtlHours] = useState(24);
  const [goal, setGoal] = useState("Authorized shopping agent");
  const [merchantName] = useState("Paybound Demo Store");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Load live categories
  useEffect(() => {
    getCategories()
      .then((cats) => {
        if (cats && cats.length > 0) {
          setAvailableCategories(cats);
        }
      })
      .catch(() => {});
  }, []);

  // Compute Paise amounts
  const budgetPaise = rupeesToPaise(budgetRupees);
  const capPaise = rupeesToPaise(capRupees);
  const expiryLabel = ttlHours === 1 ? "in 1 hour" : `in ${ttlHours} hours`;

  // Broadcast state changes to parent (for AuthorityPreview)
  useEffect(() => {
    onFormStateChange({
      budgetPaise,
      capPaise,
      categories: selectedCategories,
      merchantName,
      expiryLabel,
      goal,
    });
  }, [budgetPaise, capPaise, selectedCategories, merchantName, expiryLabel, goal, onFormStateChange]);

  // Real-time validation
  useEffect(() => {
    if (budgetPaise <= 0) {
      setValidationError("Total budget must be greater than ₹0");
    } else if (capPaise <= 0) {
      setValidationError("Per-transaction cap must be greater than ₹0");
    } else if (capPaise > budgetPaise) {
      setValidationError("Per-transaction cap cannot exceed total budget");
    } else {
      // Empty categories is valid — it authorizes all of the merchant's categories.
      setValidationError(null);
    }
  }, [budgetPaise, capPaise, selectedCategories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) return;

    await onSubmit({
      budget_total_paise: budgetPaise,
      per_txn_cap_paise: capPaise,
      allowed_categories: selectedCategories,
      // null → the backend scopes to its default demo merchant (Paybound Demo
      // Store) and its real UUID. (A merchant picker is a Phase-4 enhancement.)
      merchant_id: null,
      ttl_seconds: ttlHours * 3600,
      nl_goal: goal.trim() || `Authorized spend up to ${paiseToRupeesPlain(budgetPaise)}`,
    });
  };

  return (
    <form
      id="new-mandate-form"
      onSubmit={handleSubmit}
      className="bg-white border border-[#E5E7EB] rounded-xl p-5 sm:p-6 flex flex-col gap-4 shadow-xs"
    >
      <div className="border-b border-[#E5E7EB] pb-3">
        <h2 className="text-base font-bold text-[#111827] flex items-center gap-2">
          <span>Grant New Spending Mandate</span>
        </h2>
        <p className="text-xs text-[#6B7280] mt-0.5">
          Establish deterministic, cryptographically signed limits for your AI buyer.
        </p>
      </div>

      {/* Side-by-side Fields: Total budget & Per-txn cap */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Total Budget Field */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="input-total-budget"
            className="font-mono text-xs uppercase tracking-wider text-[#6B7280] font-semibold"
          >
            Total Budget
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-[#9CA3AF]">
              ₹
            </span>
            <input
              id="input-total-budget"
              type="number"
              min="1"
              step="any"
              value={budgetRupees}
              onChange={(e) => setBudgetRupees(e.target.value)}
              className="w-full pl-7 pr-3 py-2 bg-white border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg font-mono text-sm text-[#111827] outline-none tabular-nums font-semibold transition-colors"
              placeholder="10000"
              required
            />
          </div>
          <span className="text-[11px] font-mono text-[#9CA3AF]">
            Paise: {budgetPaise.toLocaleString()}
          </span>
        </div>

        {/* Per-Transaction Cap Field */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="input-per-txn-cap"
            className="font-mono text-xs uppercase tracking-wider text-[#6B7280] font-semibold"
          >
            Per-Transaction Cap
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-[#9CA3AF]">
              ₹
            </span>
            <input
              id="input-per-txn-cap"
              type="number"
              min="1"
              step="any"
              value={capRupees}
              onChange={(e) => setCapRupees(e.target.value)}
              className="w-full pl-7 pr-3 py-2 bg-white border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg font-mono text-sm text-[#111827] outline-none tabular-nums font-semibold transition-colors"
              placeholder="6000"
              required
            />
          </div>
          <span className="text-[11px] font-mono text-[#9CA3AF]">
            Paise: {capPaise.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Allowed Categories MultiSelect */}
      <CategoryMultiSelect
        id="mandate-category-select"
        availableCategories={availableCategories}
        selectedCategories={selectedCategories}
        onChange={setSelectedCategories}
      />

      {/* Expiry Window */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="select-expiry"
            className="font-mono text-xs uppercase tracking-wider text-[#6B7280] font-semibold"
          >
            Expires
          </label>
          <select
            id="select-expiry"
            value={ttlHours}
            onChange={(e) => setTtlHours(Number(e.target.value))}
            className="w-full px-3 py-2 bg-white border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg font-mono text-sm text-[#111827] outline-none cursor-pointer"
          >
            <option value={1}>in 1 hour (Instant session)</option>
            <option value={6}>in 6 hours</option>
            <option value={24}>in 24 hours (1 day)</option>
            <option value={72}>in 3 days</option>
            <option value={168}>in 7 days (1 week)</option>
          </select>
        </div>

        {/* Optional Mandate Label / Goal */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="input-mandate-goal"
            className="font-mono text-xs uppercase tracking-wider text-[#6B7280] font-semibold"
          >
            Mandate Purpose / Label
          </label>
          <input
            id="input-mandate-goal"
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Sports gear purchasing"
            className="w-full px-3 py-2 bg-white border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg text-sm text-[#111827] outline-none"
          />
        </div>
      </div>

      {/* Validation Message */}
      {validationError && (
        <div className="font-mono text-xs text-[#D97706] bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2 rounded-lg">
          {validationError}
        </div>
      )}

      {/* Sign Mandate Button */}
      <div className="pt-2">
        <Button
          id="btn-sign-mandate"
          type="submit"
          variant="solid"
          size="md"
          loading={loading}
          disabled={!!validationError}
          className="w-full sm:w-auto"
        >
          <ShieldCheck className="w-4 h-4" />
          Sign mandate
        </Button>
      </div>
    </form>
  );
};
