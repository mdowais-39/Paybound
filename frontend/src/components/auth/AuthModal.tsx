import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { BrandFavicon } from "../layout/BrandFavicon";
import { Button } from "../shared/Button";
import { ArrowRight, Lock, Mail, User as UserIcon, AlertCircle, ShieldCheck, Check } from "lucide-react";

export const AuthModal: React.FC<{ isOpen: boolean; onClose: () => void; initialMode?: "login" | "signup" }> = ({
  isOpen,
  onClose,
  initialMode = "login",
}) => {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else {
        if (!name.trim()) {
          throw new Error("Please enter your name or organization.");
        }
        await signUpWithEmail(email, password, name);
      }
      onClose();
    } catch (err: any) {
      console.error(err);
      let msg = err.message || "Authentication failed. Please verify credentials.";
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
        msg = "Invalid email or password.";
      } else if (err.code === "auth/email-already-in-use") {
        msg = "An account with this email already exists.";
      } else if (err.code === "auth/weak-password") {
        msg = "Password should be at least 6 characters.";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Google sign-in was cancelled or failed.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div
      id="auth-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="auth-modal-card"
        className="w-full max-w-md bg-white rounded-2xl border border-[#E5E7EB] shadow-2xl p-6 sm:p-8 flex flex-col gap-6 relative"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-[#9CA3AF] hover:text-[#111827] text-lg p-1.5 rounded-lg transition-colors cursor-pointer"
        >
          ✕
        </button>

        {/* Modal Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <BrandFavicon className="w-12 h-12 rounded-xl shadow-md mb-1" />
          <h2 className="text-xl font-bold text-[#111827] tracking-tight">
            {mode === "login" ? "Sign in to Paybound" : "Create your Paybound Account"}
          </h2>
          <p className="text-xs text-[#6B7280]">
            {mode === "login"
              ? "Access your persistent mandates, audit logs, and authorized agents."
              : "Set up enterprise agentic trust, policy controls, and real-time ledger storage."}
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="flex items-start gap-2 bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] p-3 rounded-lg text-xs font-mono">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* One-Click Google Auth */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-3 py-2.5 px-4 bg-white hover:bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl text-sm font-medium text-[#111827] shadow-xs transition-colors cursor-pointer disabled:opacity-50"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
          <span>{googleLoading ? "Signing in..." : "Continue with Google"}</span>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[#E5E7EB]" />
          <span className="text-[11px] font-mono uppercase text-[#9CA3AF] tracking-wider">or with email</span>
          <div className="flex-1 h-px bg-[#E5E7EB]" />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {mode === "signup" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-[#374151]">Full Name / Identity</label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Owais Ahmad"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg text-sm text-[#111827] outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-[#374151]">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg text-sm text-[#111827] outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-[#374151]">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={6}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-[#F9FAFB] border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg text-sm text-[#111827] outline-none"
              />
            </div>
          </div>

          <Button
            type="submit"
            variant="solid"
            size="md"
            disabled={loading}
            className="w-full justify-center mt-2"
          >
            <span>{loading ? "Processing..." : mode === "login" ? "Sign In" : "Create Account"}</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </form>

        {/* Footer Toggle */}
        <div className="text-center pt-2 border-t border-[#E5E7EB] text-xs text-[#6B7280]">
          {mode === "login" ? (
            <p>
              Don't have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className="text-[#111827] font-semibold hover:underline cursor-pointer"
              >
                Sign up
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className="text-[#111827] font-semibold hover:underline cursor-pointer"
              >
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
