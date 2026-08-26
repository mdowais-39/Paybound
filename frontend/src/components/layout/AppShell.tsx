import React, { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { TestModeBanner } from "./TestModeBanner";
import { SpendMeter } from "./SpendMeter";
import { BrandFavicon } from "./BrandFavicon";
import { useMandate } from "../../context/MandateContext";
import { useAuth } from "../../context/AuthContext";
import { AuthModal } from "../auth/AuthModal";
import { paiseToRupees } from "../../lib/money";
import { LogIn, LogOut, User as UserIcon, Shield, ChevronDown } from "lucide-react";

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { activeMandate, selectedSessionId } = useMandate();
  const { user, profile, logOut, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const auditPath = selectedSessionId
    ? `/audit/${selectedSessionId}`
    : activeMandate?.session_id
    ? `/audit/${activeMandate.session_id}`
    : "/audit"; // no fabricated fallback session; AuditPage resolves the real one

  const isAuditActive = location.pathname.startsWith("/audit");

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827] flex flex-col font-sans">
      {/* 1. Test Mode Banner */}
      <TestModeBanner />

      {/* 2. Top Navigation Bar */}
      <header
        id="app-header"
        className="w-full bg-white border-b border-[#E5E7EB] sticky top-0 z-40"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Wordmark & Brand */}
          <div className="flex items-center gap-3">
            <NavLink
              to="/mandate"
              id="nav-wordmark"
              className="flex items-center gap-2.5 hover:opacity-90 transition-opacity"
            >
              <BrandFavicon className="w-8 h-8 rounded-lg shadow-xs" />
              <span className="text-[#111827] font-bold text-[19px] tracking-tight">
                Paybound
              </span>
            </NavLink>
            <span className="hidden sm:inline-block font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB] font-medium">
              Trust Layer
            </span>
          </div>

          {/* Nav Links */}
          <nav id="main-nav" className="flex items-center gap-1 sm:gap-2">
            <NavLink
              to="/"
              id="nav-link-overview"
              className={({ isActive }) =>
                `text-xs sm:text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${
                  isActive
                    ? "bg-[#F3F4F6] text-[#111827] font-semibold"
                    : "text-[#6B7280] hover:text-[#111827] hover:bg-[#F9FAFB]"
                }`
              }
            >
              Overview
            </NavLink>
            <NavLink
              to="/mandate"
              id="nav-link-mandate"
              className={({ isActive }) =>
                `text-xs sm:text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${
                  isActive
                    ? "bg-[#F3F4F6] text-[#111827] font-semibold"
                    : "text-[#6B7280] hover:text-[#111827] hover:bg-[#F9FAFB]"
                }`
              }
            >
              Mandate
            </NavLink>
            <NavLink
              to="/shop"
              id="nav-link-shop"
              className={({ isActive }) =>
                `text-xs sm:text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${
                  isActive
                    ? "bg-[#F3F4F6] text-[#111827] font-semibold"
                    : "text-[#6B7280] hover:text-[#111827] hover:bg-[#F9FAFB]"
                }`
              }
            >
              Shop
            </NavLink>
            <NavLink
              to={auditPath}
              id="nav-link-audit"
              className={`text-xs sm:text-sm px-3 py-1.5 rounded-lg transition-colors font-medium ${
                isAuditActive
                  ? "bg-[#F3F4F6] text-[#111827] font-semibold"
                  : "text-[#6B7280] hover:text-[#111827] hover:bg-[#F9FAFB]"
              }`}
            >
              Audit
            </NavLink>
          </nav>

          {/* Right Action Stack: Mandate Chip & Auth Button */}
          <div className="flex items-center gap-3">
            {/* Active Mandate Spend Indicator */}
            {activeMandate ? (
              <NavLink
                to="/mandate"
                id="current-mandate-chip"
                className="hidden md:flex items-center gap-2.5 bg-[#F9FAFB] hover:bg-[#F3F4F6] border border-[#E5E7EB] px-3 py-1.5 rounded-full transition-colors shadow-xs"
                title={`Active Mandate: ${activeMandate.mandate_id}`}
              >
                <div className="flex items-center gap-1.5 font-mono text-xs text-[#111827] font-medium tabular-nums">
                  <span>{paiseToRupees(activeMandate.running_spend_paise || 0, true)}</span>
                  <span className="text-[#9CA3AF]">/</span>
                  <span className="text-[#6B7280]">{paiseToRupees(activeMandate.budget_total_paise, true)}</span>
                </div>
                <SpendMeter
                  usedPaise={activeMandate.running_spend_paise || 0}
                  totalPaise={activeMandate.budget_total_paise}
                  compact={true}
                  showLabels={false}
                />
              </NavLink>
            ) : null}

            {/* Authentication Control */}
            {user ? (
              <div className="relative">
                <button
                  type="button"
                  id="user-profile-menu-button"
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 py-1.5 px-3 bg-[#F9FAFB] hover:bg-[#F3F4F6] border border-[#E5E7EB] rounded-full transition-colors cursor-pointer shadow-xs"
                >
                  <div className="w-6 h-6 rounded-full bg-[#111827] text-white flex items-center justify-center text-xs font-semibold overflow-hidden">
                    {profile?.photoURL ? (
                      <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <span>{profile?.displayName?.charAt(0).toUpperCase() || "U"}</span>
                    )}
                  </div>
                  <span className="text-xs font-medium text-[#111827] max-w-[100px] truncate hidden sm:inline">
                    {profile?.displayName || user.email?.split("@")[0]}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-[#6B7280]" />
                </button>

                {/* Dropdown Menu */}
                {showUserMenu && (
                  <div
                    id="user-dropdown-menu"
                    className="absolute right-0 mt-2 w-56 bg-white border border-[#E5E7EB] rounded-xl shadow-lg p-2 z-50 animate-in fade-in"
                  >
                    <div className="px-3 py-2 border-b border-[#E5E7EB] mb-1">
                      <p className="text-xs font-bold text-[#111827] truncate">
                        {profile?.displayName || "Authenticated User"}
                      </p>
                      <p className="text-[11px] font-mono text-[#6B7280] truncate">
                        {user.email}
                      </p>
                    </div>

                    <div className="px-3 py-1.5 text-[11px] font-mono text-[#059669] flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      <span>Firestore Sync Active</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full mt-1 flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                id="header-login-button"
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#111827] hover:bg-[#1F2937] text-white text-xs sm:text-sm font-medium rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 3. Main Content Area */}
      <main className="flex-1 bg-[#F9FAFB] py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>

      {/* 4. Footer */}
      <footer className="w-full bg-white border-t border-[#E5E7EB] py-4 px-6 text-center">
        <p className="font-mono text-xs text-[#9CA3AF]">
          Paybound Trust & Authorization Console · Razorpay Test Mode
        </p>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
};
