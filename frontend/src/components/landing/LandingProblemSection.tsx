import React from "react";
import { Link } from "react-router-dom";
import { AlertOctagon, ShieldAlert, ArrowRight, Ban, Zap } from "lucide-react";

export const LandingProblemSection: React.FC = () => {
  return (
    <section id="problem" className="py-20 md:py-28 border-t border-white/10 relative bg-[#07090E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        
        {/* Section Header Badge */}
        <div className="font-mono text-xs text-[#9CA3AF] tracking-wider mb-3">
          // SECTION 01 // THE VULNERABILITY
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          
          {/* Left Column: Headline and Context */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-[1.12] font-['Plus_Jakarta_Sans',sans-serif]">
              Autonomous Shopping Starts With Vulnerability.
            </h2>

            <p className="text-sm sm:text-base text-[#9CA3AF] leading-relaxed">
              Giving LLMs raw payment credentials, credit cards, or unrestricted checkout APIs introduces catastrophic enterprise risks. Prompt injection in web pages, rogue checkout loops, and price hallucinations expose your balances to unbounded loss.
            </p>

            <p className="text-sm sm:text-base text-[#9CA3AF] leading-relaxed">
              Paybound decouples agent discovery from payment execution—isolating AI reasoning inside hard, mathematically enforced boundaries.
            </p>

            <div className="pt-2">
              <Link
                to="/mandate"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-[#07090E] hover:bg-[#F3F4F6] text-xs font-semibold shadow-lg transition-transform active:scale-95 font-['Plus_Jakarta_Sans',sans-serif]"
              >
                <span>Establish Spending Mandate</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Right Column: Fragmented Risk Cards (FinIntel style) */}
          <div className="lg:col-span-7 bg-[#0B0F19] rounded-2xl border border-white/10 p-6 flex flex-col gap-5 shadow-2xl">
            
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="font-mono text-xs text-[#9CA3AF] uppercase">
                WORKSPACE // ISOLATING AGENT THREAT VECTORS
              </span>
              <span className="font-mono text-[10px] text-[#EF4444] px-2 py-0.5 rounded bg-[#EF4444]/10 border border-[#EF4444]/20">
                CRITICAL EXPOSURE
              </span>
            </div>

            {/* 4 Threat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-2 hover:border-white/20 transition-colors">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-white font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                    prompt_injection.exploit
                  </span>
                  <span className="font-mono text-[10px] text-[#9CA3AF]">Zero-Day</span>
                </div>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Malicious web pages and reviews inject hidden system overrides attempting to hijack agent carts and redirect payment links.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-2 hover:border-white/20 transition-colors">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-white font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                    runaway_loops.drain
                  </span>
                  <span className="font-mono text-[10px] text-[#9CA3AF]">Infinite Loop</span>
                </div>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Autonomous agents caught in recursive purchasing loops execute repeated transactions, exhausting company capital.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-2 hover:border-white/20 transition-colors">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-white font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                    merchant_mismatch.fail
                  </span>
                  <span className="font-mono text-[10px] text-[#9CA3AF]">Phishing</span>
                </div>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Unverified checkout redirects route funds to unvetted third-party payment gateways and fake merchant storefronts.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-2 hover:border-white/20 transition-colors">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-white font-semibold flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
                    unproven_intent.trace
                  </span>
                  <span className="font-mono text-[10px] text-[#9CA3AF]">Zero Ledger</span>
                </div>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  No cryptographic non-repudiation or immutable proof that a human principal authorized the transaction parameters.
                </p>
              </div>

            </div>

            {/* Bottom Callout Banner */}
            <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3 text-xs text-[#D1D5DB]">
              <span className="text-base">⚡</span>
              <span>
                Paybound transforms fragmented, risky agent commands into structured, cryptographically bound delegate executions.
              </span>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
