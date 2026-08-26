import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Hash, Lock, CheckCircle2, ArrowRight } from "lucide-react";

export const LandingAuditSection: React.FC = () => {
  return (
    <section id="audit" className="py-20 md:py-28 border-t border-white/10 relative bg-[#07090E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        
        {/* Section Header Badge */}
        <div className="font-mono text-xs text-[#9CA3AF] tracking-wider mb-3">
          // SECTION 03 // AUDIT PROVENANCE
        </div>

        <div className="flex flex-col gap-12">
          
          {/* Header Row */}
          <div className="max-w-3xl flex flex-col gap-4">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-[1.12] font-['Plus_Jakarta_Sans',sans-serif]">
              Every Decision Sealed In An Immutable Ledger.
            </h2>
            <p className="text-sm sm:text-base text-[#9CA3AF] leading-relaxed">
              Every action taken by your agent, kernel evaluation, and payment trigger is hashed using SHA-256 and chained to the previous block. Paybound gives compliance, fraud, and risk teams complete non-repudiation and forensic visibility.
            </p>
          </div>

          {/* 4 Connected Cryptographic Blocks */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
            
            {/* Block 1 */}
            <div className="p-5 rounded-2xl bg-[#0B0F19] border border-white/10 flex flex-col justify-between gap-4 shadow-xl relative group hover:border-white/20 transition-all">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[#9CA3AF]">SEQ #01</span>
                  <span className="px-1.5 py-0.5 rounded bg-white/10 text-white">GENESIS</span>
                </div>
                <h4 className="text-sm font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  Session Initialization
                </h4>
                <p className="text-xs text-[#9CA3AF]">
                  Human signs mandate with Ed25519 key specifying ₹10,000 budget &amp; ₹6,000 cap.
                </p>
              </div>

              <div className="pt-3 border-t border-white/10 font-mono text-[10px] text-[#9CA3AF] flex flex-col gap-1">
                <div>PREV: <span className="text-[#6B7280]">0000000000000000</span></div>
                <div>HASH: <span className="text-[#60A5FA]">8f7e6d5c4b3a...</span></div>
              </div>
            </div>

            {/* Block 2 */}
            <div className="p-5 rounded-2xl bg-[#0B0F19] border border-white/10 flex flex-col justify-between gap-4 shadow-xl relative group hover:border-white/20 transition-all">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[#9CA3AF]">SEQ #02</span>
                  <span className="px-1.5 py-0.5 rounded bg-[#F59E0B]/20 text-[#FDE68A]">PROPOSAL</span>
                </div>
                <h4 className="text-sm font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  Discovery Cart Built
                </h4>
                <p className="text-xs text-[#9CA3AF]">
                  AI worker discovers item &amp; packages proposed line items (₹2,998.00).
                </p>
              </div>

              <div className="pt-3 border-t border-white/10 font-mono text-[10px] text-[#9CA3AF] flex flex-col gap-1">
                <div>PREV: <span className="text-[#60A5FA]">8f7e6d5c4b3a...</span></div>
                <div>HASH: <span className="text-[#FBBF24]">9a8b7c6d5e4f...</span></div>
              </div>
            </div>

            {/* Block 3 */}
            <div className="p-5 rounded-2xl bg-[#0B0F19] border border-[#10B981]/30 flex flex-col justify-between gap-4 shadow-xl relative group hover:border-[#10B981]/50 transition-all">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[#9CA3AF]">SEQ #03</span>
                  <span className="px-1.5 py-0.5 rounded bg-[#10B981]/20 text-[#A7F3D0]">GATE PASS</span>
                </div>
                <h4 className="text-sm font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  9-Rule Kernel Verdict
                </h4>
                <p className="text-xs text-[#9CA3AF]">
                  Pre-execution kernel verifies all spending bounds and categories deterministically, with no LLM in the loop.
                </p>
              </div>

              <div className="pt-3 border-t border-white/10 font-mono text-[10px] text-[#9CA3AF] flex flex-col gap-1">
                <div>PREV: <span className="text-[#FBBF24]">9a8b7c6d5e4f...</span></div>
                <div>HASH: <span className="text-[#34D399]">4e5f6a7b8c9d...</span></div>
              </div>
            </div>

            {/* Block 4 */}
            <div className="p-5 rounded-2xl bg-[#0B0F19] border border-white/10 flex flex-col justify-between gap-4 shadow-xl relative group hover:border-white/20 transition-all">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[#9CA3AF]">SEQ #04</span>
                  <span className="px-1.5 py-0.5 rounded bg-[#3B82F6]/20 text-[#93C5FD]">SETTLEMENT</span>
                </div>
                <h4 className="text-sm font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  Razorpay Link Generated
                </h4>
                <p className="text-xs text-[#9CA3AF]">
                  Execution plane creates single-use checkout link on Razorpay test rails.
                </p>
              </div>

              <div className="pt-3 border-t border-white/10 font-mono text-[10px] text-[#9CA3AF] flex flex-col gap-1">
                <div>PREV: <span className="text-[#34D399]">4e5f6a7b8c9d...</span></div>
                <div>HASH: <span className="text-[#60A5FA]">1a2b3c4d5e6f...</span></div>
              </div>
            </div>

          </div>

          {/* Verification Bar */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            <div className="flex items-center gap-2 text-white">
              <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
              <span>CRYPTOGRAPHIC LEDGER INTEGRITY: 100% SEALED</span>
            </div>

            <Link
              to="/audit"
              className="inline-flex items-center gap-1.5 text-white hover:text-[#93C5FD] transition-colors"
            >
              <span>Explore Live Audit Timeline</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

        </div>

      </div>
    </section>
  );
};
