import React from "react";
import { Link } from "react-router-dom";
import { Layers, Cpu, Shield, Database, ArrowRight, Code, KeyRound } from "lucide-react";

export const LandingArchitectureSection: React.FC = () => {
  return (
    <section id="architecture" className="py-20 md:py-28 border-t border-white/10 relative bg-[#07090E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        
        {/* Section Header Badge */}
        <div className="font-mono text-xs text-[#9CA3AF] tracking-wider mb-3">
          // SECTION 04 // PIPELINE ARCHITECTURE
        </div>

        <div className="flex flex-col gap-12">
          
          <div className="max-w-3xl flex flex-col gap-4">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-[1.12] font-['Plus_Jakarta_Sans',sans-serif]">
              Architected For Uncompromising Agentic Governance.
            </h2>
            <p className="text-sm sm:text-base text-[#9CA3AF] leading-relaxed">
              Paybound operates as an autonomous sidecar and authorization proxy. Any agentic framework (Gemini, LangChain, AutoGen, CrewAI) can propose purchases, but only Paybound can mathematically issue settlement links.
            </p>
          </div>

          {/* 4 Architectural Layers */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            
            <div className="p-6 rounded-2xl bg-[#0B0F19] border border-white/10 flex flex-col justify-between gap-6 hover:border-white/20 transition-all">
              <div className="flex flex-col gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white">
                  <KeyRound className="w-5 h-5 text-[#60A5FA]" />
                </div>
                <h3 className="text-base font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  1. Intent Mandates
                </h3>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Cryptographically signed policies dictating budget caps, expiry timestamps, allowed categories, and human escalation rules.
                </p>
              </div>
              <div className="font-mono text-[10px] text-[#60A5FA]">
                ED25519 SIGNATURES
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-[#0B0F19] border border-white/10 flex flex-col justify-between gap-6 hover:border-white/20 transition-all">
              <div className="flex flex-col gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white">
                  <Cpu className="w-5 h-5 text-[#34D399]" />
                </div>
                <h3 className="text-base font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  2. Rust Kernel Axioms
                </h3>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Zero-LLM deterministic pre-execution engine evaluating 9 hard rules in sub-millisecond speeds. Immune to prompt injections.
                </p>
              </div>
              <div className="font-mono text-[10px] text-[#34D399]">
                0.8MS EVALUATION LATENCY
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-[#0B0F19] border border-white/10 flex flex-col justify-between gap-6 hover:border-white/20 transition-all">
              <div className="flex flex-col gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white">
                  <Shield className="w-5 h-5 text-[#FBBF24]" />
                </div>
                <h3 className="text-base font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  3. Razorpay Rails
                </h3>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Payment abstraction layer creating single-use sandbox payment links. Agents never see API secrets or raw cards.
                </p>
              </div>
              <div className="font-mono text-[10px] text-[#FBBF24]">
                RAZORPAY TEST SANDBOX
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-[#0B0F19] border border-white/10 flex flex-col justify-between gap-6 hover:border-white/20 transition-all">
              <div className="flex flex-col gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white">
                  <Database className="w-5 h-5 text-[#A78BFA]" />
                </div>
                <h3 className="text-base font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  4. Firestore Sync
                </h3>
                <p className="text-xs text-[#9CA3AF] leading-relaxed">
                  Real-time cloud database maintaining user authentication, mandate budgets, audit sequences, and active checkout sessions.
                </p>
              </div>
              <div className="font-mono text-[10px] text-[#A78BFA]">
                CLOUD FIRESTORE DB
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
