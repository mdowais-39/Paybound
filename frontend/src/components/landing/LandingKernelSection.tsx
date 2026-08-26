import React from "react";
import { Link } from "react-router-dom";
import { Check, X, ShieldAlert, ArrowRight, ShieldCheck } from "lucide-react";

export const LandingKernelSection: React.FC = () => {
  return (
    <section id="kernel" className="py-20 md:py-28 border-t border-white/10 relative bg-[#07090E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        
        {/* Section Header Badge */}
        <div className="font-mono text-xs text-[#9CA3AF] tracking-wider mb-3">
          // SECTION 02 // DETERMINISTIC ENFORCEMENT
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Fund Flow Sequence Table (FinIntel inspired) */}
          <div className="lg:col-span-6 bg-[#0B0F19] rounded-2xl border border-white/10 p-5 sm:p-6 flex flex-col gap-4 shadow-2xl">
            
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="font-mono text-xs text-[#9CA3AF]">
                GRAPH EXTRACTION // FUND FLOW SEQUENCE
              </span>
              <span className="font-mono text-[10px] text-[#34D399] px-2 py-0.5 rounded bg-[#10B981]/10 border border-[#10B981]/20">
                LLM-FREE KERNEL
              </span>
            </div>

            {/* Sequence Rows */}
            <div className="flex flex-col gap-2.5">
              
              {/* Row 1: Approved */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-white font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                  <span>Footwear Copilot</span>
                </div>
                <div className="font-mono text-[11px] text-[#9CA3AF] flex items-center gap-1.5">
                  <span>──</span>
                  <span className="text-white font-semibold">₹2,998 Wire</span>
                  <span>──▶</span>
                </div>
                <div className="font-mono text-xs text-[#10B981] font-semibold flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>Approved</span>
                </div>
              </div>

              {/* Row 2: Refused */}
              <div className="p-3 rounded-xl bg-[#EF4444]/5 border border-[#EF4444]/20 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-white font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                  <span>Rogue Item Request</span>
                </div>
                <div className="font-mono text-[11px] text-[#9CA3AF] flex items-center gap-1.5">
                  <span>──</span>
                  <span className="text-[#EF4444] font-semibold">₹8,499 Cap Exceeded</span>
                  <span>──▶</span>
                </div>
                <div className="font-mono text-xs text-[#EF4444] font-semibold flex items-center gap-1">
                  <X className="w-3.5 h-3.5" />
                  <span>Refused</span>
                </div>
              </div>

              {/* Row 3: Needs Human */}
              <div className="p-3 rounded-xl bg-[#F59E0B]/5 border border-[#F59E0B]/20 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-white font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                  <span>Studio Hardware</span>
                </div>
                <div className="font-mono text-[11px] text-[#9CA3AF] flex items-center gap-1.5">
                  <span>──</span>
                  <span className="text-[#F59E0B] font-semibold">₹18,500 High-Value</span>
                  <span>──▶</span>
                </div>
                <div className="font-mono text-xs text-[#F59E0B] font-semibold flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Needs PIN</span>
                </div>
              </div>

              {/* Row 4: Approved */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-white font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                  <span>Home Essentials</span>
                </div>
                <div className="font-mono text-[11px] text-[#9CA3AF] flex items-center gap-1.5">
                  <span>──</span>
                  <span className="text-white font-semibold">₹1,499 Wire</span>
                  <span>──▶</span>
                </div>
                <div className="font-mono text-xs text-[#10B981] font-semibold flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>Approved</span>
                </div>
              </div>

            </div>

            {/* Sub-footer inside box */}
            <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-[#9CA3AF] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#3B82F6]" />
              <span>Closed policy verification loop fully mapped. Zero unauthorized drift.</span>
            </div>

          </div>

          {/* Right Column: Copywriting & 4 numbered rules */}
          <div className="lg:col-span-6 flex flex-col gap-6">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-[1.12] font-['Plus_Jakarta_Sans',sans-serif]">
              Every Transaction Leaves A Verifiable Trail.
            </h2>

            <p className="text-sm sm:text-base text-[#9CA3AF] leading-relaxed">
              Money moves through models, tool calls, merchants, and intermediaries. Paybound validates every cart item before issuing checkout links, eliminating hallucinated items and unauthorized charges.
            </p>

            {/* Numbered Feature List (FinIntel style) */}
            <div className="flex flex-col gap-3 pt-2 font-mono text-xs">
              
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/10 text-white">
                <span className="w-6 h-6 rounded-lg bg-white/10 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  1
                </span>
                <span>Deterministic pre-execution spending limit enforcement</span>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/10 text-white">
                <span className="w-6 h-6 rounded-lg bg-white/10 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  2
                </span>
                <span>Autonomous restriction to verified merchant &amp; category allowlists</span>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/10 text-white">
                <span className="w-6 h-6 rounded-lg bg-white/10 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  3
                </span>
                <span>Zero prompt-injection leakage via out-of-band Rust Kernel gating</span>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/10 text-white">
                <span className="w-6 h-6 rounded-lg bg-white/10 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  4
                </span>
                <span>Automated escalation for high-value purchases requiring human AFA</span>
              </div>

            </div>

            <div className="pt-2">
              <Link
                to="/shop"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-[#07090E] hover:bg-[#F3F4F6] text-xs font-semibold shadow-lg transition-transform active:scale-95 font-['Plus_Jakarta_Sans',sans-serif]"
              >
                <span>Test Live Shopping Delegate</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
