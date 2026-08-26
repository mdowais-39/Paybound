import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Cpu, Lock, CheckCircle2 } from "lucide-react";

export const LandingHero: React.FC = () => {
  return (
    <section id="hero" className="relative pt-20 pb-16 md:pt-28 md:pb-24 overflow-hidden">
      {/* Background glow and subtle ambient elements */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-gradient-to-tr from-[#3B82F6]/15 to-[#10B981]/10 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center flex flex-col items-center">
        {/* Monospace Badge Indicator */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] sm:text-xs font-mono text-[#D1D5DB] mb-8 shadow-inner">
          <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
          <span className="text-[#9CA3AF]">//</span>
          <span className="text-white font-medium">PAYBOUND KERNEL v2.4</span>
          <span className="text-[#6B7280]">·</span>
          <span className="text-[#A7F3D0]">ZERO PROMPT INJECTION LEAKAGE</span>
        </div>

        {/* Display Headline */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.08] font-['Plus_Jakarta_Sans',sans-serif] max-w-4xl">
          Turn Autonomous AI Agents <br className="hidden sm:inline" />
          Into <span className="text-[#9CA3AF] font-bold">Bound Delegates.</span>
        </h1>

        {/* Subtitle */}
        <p className="mt-6 text-base sm:text-lg md:text-xl text-[#9CA3AF] max-w-3xl leading-relaxed font-normal">
          Assign cryptographic spending budgets, per-transaction caps, merchant allowlists, and deterministic 9-rule enforcement to autonomous AI shoppers. Zero prompt injection leakage. 100% mathematical auditability.
        </p>

        {/* Dual CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
          <Link
            to="/mandate"
            id="hero-primary-cta"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-3.5 bg-white text-[#07090E] hover:bg-[#F3F4F6] text-sm sm:text-base font-bold rounded-xl shadow-2xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] font-['Plus_Jakarta_Sans',sans-serif]"
          >
            <span>Launch Operations Center</span>
            <ArrowRight className="w-4 h-4" />
          </Link>

          <a
            href="#interactive-workspace"
            id="hero-secondary-cta"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-[#0F1420] text-white hover:bg-[#1A2234] border border-white/15 text-sm sm:text-base font-semibold rounded-xl transition-all duration-200"
          >
            <span>See How It Works</span>
          </a>
        </div>

        {/* Micro-Features Ticker */}
        <div className="mt-16 pt-8 border-t border-white/10 w-full max-w-4xl grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#9CA3AF]">
              DETERMINISTIC GATING
            </span>
            <span className="text-xs font-semibold text-white">9-Rule Hard Kernel</span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#9CA3AF]">
              PROVENANCE ENGINE
            </span>
            <span className="text-xs font-semibold text-white">SHA-256 Hash Chain</span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#9CA3AF]">
              HUMAN SAFEGUARD
            </span>
            <span className="text-xs font-semibold text-white">&gt; ₹15,000 AFA Escalation</span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#9CA3AF]">
              SETTLEMENT RAILS
            </span>
            <span className="text-xs font-semibold text-white">Razorpay Test Mode</span>
          </div>
        </div>
      </div>
    </section>
  );
};
