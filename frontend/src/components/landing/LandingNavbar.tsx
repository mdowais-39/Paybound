import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandFavicon } from "../layout/BrandFavicon";
import { useAuth } from "../../context/AuthContext";
import { AuthModal } from "../auth/AuthModal";
import { ArrowRight, LogIn, ShieldCheck, Terminal, User as UserIcon } from "lucide-react";

export const LandingNavbar: React.FC = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <header
        id="landing-header"
        className="w-full bg-[#07090E]/90 backdrop-blur-md border-b border-white/10 sticky top-0 z-50 transition-colors"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-18 flex items-center justify-between">
          {/* Logo & Brand Wordmark */}
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="relative">
                <BrandFavicon className="w-8 h-8 rounded-lg shadow-lg border border-white/10 group-hover:border-white/30 transition-colors" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#10B981] rounded-full ring-2 ring-[#07090E] animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xl tracking-tight text-white font-['Plus_Jakarta_Sans',sans-serif]">
                  Paybound
                </span>
                <span className="hidden sm:inline-block font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-[#9CA3AF] border border-white/10">
                  Trust Layer
                </span>
              </div>
            </Link>
          </div>

          {/* Navigation Links with Monospace section indicators */}
          <nav className="hidden lg:flex items-center gap-6">
            <a
              href="#problem"
              className="text-xs font-mono text-[#9CA3AF] hover:text-white transition-colors tracking-wide"
            >
              // 01 THE RISK
            </a>
            <a
              href="#kernel"
              className="text-xs font-mono text-[#9CA3AF] hover:text-white transition-colors tracking-wide"
            >
              // 02 DETERMINISTIC KERNEL
            </a>
            <a
              href="#audit"
              className="text-xs font-mono text-[#9CA3AF] hover:text-white transition-colors tracking-wide"
            >
              // 03 AUDIT LEDGER
            </a>
            <a
              href="#architecture"
              className="text-xs font-mono text-[#9CA3AF] hover:text-white transition-colors tracking-wide"
            >
              // 04 ARCHITECTURE
            </a>
            <a
              href="#interactive-workspace"
              className="text-xs font-mono text-[#9CA3AF] hover:text-white transition-colors tracking-wide"
            >
              // WORKSPACE
            </a>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/mandate")}
                  className="flex items-center gap-2 py-1.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white font-medium transition-colors cursor-pointer"
                >
                  <div className="w-5 h-5 rounded-full bg-white text-[#111827] flex items-center justify-center text-[10px] font-bold">
                    {profile?.displayName?.charAt(0).toUpperCase() || "U"}
                  </div>
                  <span className="hidden sm:inline max-w-[120px] truncate">
                    {profile?.displayName || user.email?.split("@")[0]}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/mandate")}
                  className="flex items-center gap-1.5 py-2 px-4 bg-white text-[#07090E] hover:bg-[#F3F4F6] text-xs font-semibold rounded-xl shadow-lg transition-transform active:scale-95 cursor-pointer"
                >
                  <span>Open Console</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs text-[#D1D5DB] hover:text-white font-medium transition-colors cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/mandate")}
                  className="flex items-center gap-2 py-2 px-4 bg-white text-[#07090E] hover:bg-[#F3F4F6] text-xs sm:text-sm font-semibold rounded-xl shadow-xl transition-all hover:shadow-white/10 active:scale-95 cursor-pointer font-['Plus_Jakarta_Sans',sans-serif]"
                >
                  <span>Launch Operations Center</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Auth Modal */}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </>
  );
};
