import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ArrowRight, HelpCircle } from "lucide-react";

export const LandingFaqSection: React.FC = () => {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const faqs = [
    {
      q: "How does Paybound prevent prompt injection from overriding spending limits?",
      a: "Prompt injections exploit the probabilistic nature of LLMs when models make execution decisions. Paybound decouples reasoning from authorization: the AI agent is only allowed to propose a JSON cart. The Paybound Kernel (implemented in deterministic code outside the LLM context) tests the proposal against 9 mathematical axioms. No matter what prompt or instruction is embedded in the web page or user query, the kernel evaluates hard numerical caps and allowlists.",
    },
    {
      q: "Why is Razorpay test mode used instead of raw card numbers?",
      a: "Autonomous AI agents should never have direct access to raw credit card numbers or long-lived API secrets. Paybound generates ephemeral, scoped, single-use Razorpay payment links for verified carts. This guarantees that payments can only settle with the exact authorized amount and merchant.",
    },
    {
      q: "What is the Human AFA Escalation threshold (> ₹15,000)?",
      a: "For transactions exceeding ₹15,000, Paybound triggers an Automated Factor Authentication (AFA) check requiring a human PIN or approval. This ensures high-ticket items cannot be purchased autonomously without human oversight, while routine everyday items within budget are fulfilled frictionlessly.",
    },
    {
      q: "How does cryptographic SHA-256 hash chaining work in Paybound?",
      a: "Each lifecycle event—from mandate signing, discovery proposals, kernel evaluation, to payment generation—is recorded as a discrete block with the previous block's SHA-256 hash. This forms an immutable audit chain in Cloud Firestore, guaranteeing that historical decisions cannot be forged or tampered with.",
    },
  ];

  return (
    <section id="faq" className="py-20 md:py-28 border-t border-white/10 relative bg-[#07090E]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        
        {/* Section Header Badge */}
        <div className="font-mono text-xs text-[#9CA3AF] tracking-wider mb-3 text-center">
          // SECTION 05 // FREQUENTLY ASKED QUESTIONS
        </div>

        <h2 className="text-3xl sm:text-4xl font-extrabold text-white text-center tracking-tight mb-12 font-['Plus_Jakarta_Sans',sans-serif]">
          Everything You Need To Know.
        </h2>

        {/* FAQ Accordion */}
        <div className="flex flex-col gap-3">
          {faqs.map((faq, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={idx}
                className="rounded-xl bg-[#0B0F19] border border-white/10 overflow-hidden transition-colors"
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  className="w-full p-5 text-left flex items-center justify-between gap-4 text-sm sm:text-base font-bold text-white hover:text-[#93C5FD] transition-colors cursor-pointer font-['Plus_Jakarta_Sans',sans-serif]"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#9CA3AF] shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-white" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-xs sm:text-sm text-[#9CA3AF] leading-relaxed border-t border-white/5 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Final Conversion Banner */}
        <div className="mt-16 p-8 rounded-2xl bg-gradient-to-br from-[#0B0F19] to-white/5 border border-white/15 text-center flex flex-col items-center gap-6 shadow-2xl">
          <div className="flex flex-col gap-2 max-w-xl">
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white font-['Plus_Jakarta_Sans',sans-serif]">
              Ready to Govern Autonomous AI Shoppers?
            </h3>
            <p className="text-xs sm:text-sm text-[#9CA3AF]">
              Deploy scoped spending mandates, test AI shopping copilot interactions, and audit cryptographic ledgers on Razorpay test rails.
            </p>
          </div>

          <Link
            to="/mandate"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-[#07090E] hover:bg-[#F3F4F6] text-sm font-bold rounded-xl shadow-xl transition-all hover:scale-105 active:scale-95 font-['Plus_Jakarta_Sans',sans-serif]"
          >
            <span>Launch Operations Center</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

      </div>
    </section>
  );
};
