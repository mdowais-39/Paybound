import React from "react";
import { Link } from "react-router-dom";
import { BrandFavicon } from "../layout/BrandFavicon";
import { ShieldCheck, Lock, Activity } from "lucide-react";

export const LandingFooter: React.FC = () => {
  return (
    <footer className="w-full bg-[#05070B] border-t border-white/10 py-12 px-4 sm:px-6 text-[#9CA3AF]">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
        
        {/* Brand & Mission */}
        <div className="flex flex-col gap-3 max-w-sm text-center md:text-left items-center md:items-start">
          <div className="flex items-center gap-3">
            <BrandFavicon className="w-7 h-7 rounded-lg border border-white/10" />
            <span className="font-bold text-lg text-white font-['Plus_Jakarta_Sans',sans-serif]">
              Paybound
            </span>
            <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-white/5 text-[#9CA3AF] border border-white/10">
              Trust Layer
            </span>
          </div>
          <p className="text-xs text-[#6B7280] leading-relaxed">
            Deterministic trust-and-authorization governance for autonomous AI shopping agents on Razorpay test rails.
          </p>
        </div>

        {/* Links */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-mono">
          <Link to="/mandate" className="hover:text-white transition-colors">
            // MANDATE ENGINE
          </Link>
          <Link to="/shop" className="hover:text-white transition-colors">
            // COPILOT SHOP
          </Link>
          <Link to="/audit" className="hover:text-white transition-colors">
            // AUDIT CHAIN
          </Link>
          <Link to="/login" className="hover:text-white transition-colors">
            // AUTHENTICATION
          </Link>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-3 text-[11px] font-mono text-[#6B7280]">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
            Firestore Cloud Sync
          </span>
          <span>·</span>
          <span>Razorpay Rails</span>
        </div>

      </div>

      <div className="max-w-7xl mx-auto mt-8 pt-8 border-t border-white/5 text-center text-[11px] font-mono text-[#4B5563]">
        © {new Date().getFullYear()} Paybound Technologies Inc. All rights reserved. Mathematical authorization guaranteed.
      </div>
    </footer>
  );
};
