import React from "react";
import { LandingNavbar } from "../components/landing/LandingNavbar";
import { LandingHero } from "../components/landing/LandingHero";
import { LandingInteractiveConsole } from "../components/landing/LandingInteractiveConsole";
import { LandingProblemSection } from "../components/landing/LandingProblemSection";
import { LandingKernelSection } from "../components/landing/LandingKernelSection";
import { LandingAuditSection } from "../components/landing/LandingAuditSection";
import { LandingArchitectureSection } from "../components/landing/LandingArchitectureSection";
import { LandingFaqSection } from "../components/landing/LandingFaqSection";
import { LandingFooter } from "../components/landing/LandingFooter";

export const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#07090E] text-white flex flex-col font-sans selection:bg-white/20 selection:text-white">
      {/* 1. Sleek Navigation */}
      <LandingNavbar />

      {/* 2. Hero Section */}
      <main className="flex-1 flex flex-col">
        <LandingHero />

        {/* 3. Interactive Workspace & Topologic Console (FinIntel inspired) */}
        <LandingInteractiveConsole />

        {/* 4. Section 01: The Vulnerability / Evidence */}
        <LandingProblemSection />

        {/* 5. Section 02: Deterministic Kernel Extraction */}
        <LandingKernelSection />

        {/* 6. Section 03: Cryptographic Audit Ledger */}
        <LandingAuditSection />

        {/* 7. Section 04: Architecture Pipeline */}
        <LandingArchitectureSection />

        {/* 8. Section 05: FAQs & Final CTA */}
        <LandingFaqSection />
      </main>

      {/* 9. Footer */}
      <LandingFooter />
    </div>
  );
};
