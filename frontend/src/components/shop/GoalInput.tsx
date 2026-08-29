import React, { useState, useRef, useEffect } from "react";
import { ArrowUp, Zap, ChevronUp, CheckCircle2, AlertTriangle, ShieldAlert, HelpCircle, Sparkles } from "lucide-react";

interface GoalInputProps {
  onSendGoal: (goal: string) => Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  onScenarioSelect?: (scenarioKey: string) => void;
  id?: string;
  /** True when the open cart is mid-conversation (CLARIFY/CHOOSE) — the next
   * message refines that same exchange rather than starting a new purchase. */
  continuing?: boolean;
}

const TEST_SCENARIOS = [
  {
    id: "approved_shoes",
    label: "A: Running Shoes (< ₹3,000)",
    prompt: "buy running shoes under 3000",
    badge: "Approved",
    badgeColor: "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]",
    icon: CheckCircle2,
    desc: "₹2,998 purchase within ₹6,000 per-txn cap",
  },
  {
    id: "refused_chair",
    label: "B: Executive Chair (Over Cap)",
    prompt: "buy high-end leather executive office chair",
    badge: "Refused",
    badgeColor: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]",
    icon: AlertTriangle,
    desc: "₹8,499 exceeds ₹6,000 per-txn mandate rule",
  },
  {
    id: "human_monitor",
    label: "C: 4K Studio Monitor (High Value)",
    prompt: "buy 4K UltraHD Studio Monitor",
    badge: "Human AFA",
    badgeColor: "bg-[#FAF5FF] text-[#7C3AED] border-[#DDD6FE]",
    icon: ShieldAlert,
    desc: "₹18,500 requires explicit human sign-off",
  },
  {
    id: "ambiguous_query",
    label: "D: Ambiguous Request",
    prompt: "buy something nice maybe",
    badge: "Clarify",
    badgeColor: "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]",
    icon: HelpCircle,
    desc: "Prompts conversational intent refinement",
  },
];

export const GoalInput: React.FC<GoalInputProps> = ({
  onSendGoal,
  loading = false,
  disabled = false,
  id,
  continuing = false,
}) => {
  const [goalText, setGoalText] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = goalText.trim();
    if (!clean || loading || disabled) return;
    setGoalText("");
    setIsDropdownOpen(false);
    await onSendGoal(clean);
  };

  const handleSelectScenario = async (prompt: string) => {
    setIsDropdownOpen(false);
    setGoalText("");
    await onSendGoal(prompt);
  };

  return (
    <div id={id || "goal-input-floating-container"} className="w-full max-w-3xl mx-auto relative pointer-events-auto">
      {/* Upward Test Scenarios Dropdown Menu */}
      {isDropdownOpen && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full mb-3 left-0 right-0 sm:left-2 sm:right-auto sm:w-[420px] bg-white border border-[#E5E7EB] rounded-2xl shadow-2xl p-2.5 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150 ring-1 ring-black/5"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#F3F4F6] mb-1">
            <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#111827] uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5 text-[#2563EB]" />
              <span>Select Test Scenario</span>
            </div>
            <span className="text-[11px] text-[#9CA3AF] font-mono">Instant Run</span>
          </div>

          <div className="space-y-1">
            {TEST_SCENARIOS.map((sc) => {
              const Icon = sc.icon;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => handleSelectScenario(sc.prompt)}
                  disabled={loading || disabled}
                  className="w-full p-2.5 rounded-xl hover:bg-[#F9FAFB] active:bg-[#F3F4F6] transition-colors text-left flex items-start justify-between gap-3 group cursor-pointer border border-transparent hover:border-[#E5E7EB]"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[#F3F4F6] group-hover:bg-white group-hover:shadow-xs flex items-center justify-center text-[#111827] shrink-0 mt-0.5 transition-all">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[#111827] group-hover:text-[#2563EB] transition-colors">
                        {sc.label}
                      </div>
                      <div className="text-[11px] text-[#6B7280] font-mono mt-0.5">
                        {sc.desc}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border shrink-0 ${sc.badgeColor}`}
                  >
                    {sc.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Modern Floating Search & Goal Input Bar */}
      <form
        onSubmit={handleSubmit}
        className="bg-white/95 backdrop-blur-md border border-[#D1D5DB] hover:border-[#9CA3AF] focus-within:border-[#111827] focus-within:ring-2 focus-within:ring-[#111827]/10 rounded-full shadow-lg transition-all flex items-center p-1.5 pl-2 sm:pl-3 gap-2"
      >
        {/* Scenario Dropdown Toggle Button */}
        <div ref={dropdownRef} className="relative shrink-0">
          <button
            type="button"
            id="btn-toggle-scenarios-dropdown"
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            disabled={loading || disabled}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-mono font-semibold transition-all cursor-pointer ${
              isDropdownOpen
                ? "bg-[#111827] text-white shadow-xs"
                : "bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#1F2937]"
            }`}
            title="Click to choose a preset test scenario"
          >
            <Zap className={`w-3.5 h-3.5 ${isDropdownOpen ? "text-[#93C5FD]" : "text-[#2563EB]"}`} />
            <span className="hidden sm:inline">Scenarios</span>
            <ChevronUp
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                isDropdownOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>

        {/* Input Text Box with Crisp, Evident High-Contrast Styling */}
        <div className="flex-1 min-w-0 relative flex items-center">
          <input
            ref={inputRef}
            id="input-shop-goal"
            type="text"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            disabled={loading || disabled}
            placeholder={
              disabled
                ? "Select an active mandate above to begin shopping..."
                : continuing
                  ? "Refine this — e.g. 'actually, under 2000' or 'something else'..."
                  : "Tell the agent what to buy (e.g., 'buy running shoes under 3000')..."
            }
            className="w-full bg-transparent text-sm sm:text-[15px] font-semibold text-[#0F172A] placeholder:text-[#64748B] placeholder:font-normal focus:outline-none py-2 px-1 disabled:opacity-50"
          />
        </div>

        {/* Send Action Button */}
        <button
          id="btn-send-goal"
          type="submit"
          disabled={!goalText.trim() || loading || disabled}
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#111827] hover:bg-[#1F2937] active:scale-95 text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:hover:bg-[#111827] disabled:active:scale-100 disabled:cursor-not-allowed cursor-pointer shadow-md shrink-0 mr-0.5"
          title="Run Agent Shopping Pipeline"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <ArrowUp className="w-4 h-4 sm:w-5 sm:h-5 text-white stroke-[2.5]" />
          )}
        </button>
      </form>
    </div>
  );
};
