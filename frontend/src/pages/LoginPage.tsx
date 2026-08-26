import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { BrandFavicon } from "../components/layout/BrandFavicon";
import { Button } from "../components/shared/Button";
import {
  ArrowRight,
  Lock,
  Mail,
  User as UserIcon,
  AlertCircle,
  ShieldCheck,
  Zap,
  KeyRound,
  CheckCircle2,
} from "lucide-react";

export const LoginPage: React.FC = () => {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  // If already logged in, redirect
  React.useEffect(() => {
    if (user) {
      navigate("/mandates");
    }
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else {
        if (!name.trim()) {
          throw new Error("Please enter your full name or identity.");
        }
        await signUpWithEmail(email, password, name);
      }
      navigate("/mandates");
    } catch (err: any) {
      console.error(err);
      let msg = err.message || "Authentication failed.";
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
      navigate("/mandates");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Google sign-in failed.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div id="page-login" className="min-h-[80vh] flex items-center justify-center py-6 px-4">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 bg-white rounded-2xl border border-[#E5E7EB] shadow-xl overflow-hidden">
        
        {/* Left Informational Showcase Column */}
        <div className="md:col-span-5 bg-[#111827] text-white p-8 flex flex-col justify-between relative overflow-hidden">
          <div className="relative z-10 flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <BrandFavicon className="w-10 h-10 rounded-lg shadow-md" />
              <span className="font-bold text-xl tracking-tight text-white">Paybound</span>
            </div>

            <div>
              <h2 className="text-xl font-bold text-white tracking-tight mb-2">
                Agentic Trust &amp; Governance
              </h2>
              <p className="text-xs text-[#9CA3AF] leading-relaxed">
                Connect autonomous purchasing delegates to deterministic budget boundaries, cryptographic audit logs, and test rails.
              </p>
            </div>

            <div className="flex flex-col gap-3.5 pt-2 border-t border-white/10">
              <div className="flex items-start gap-2.5 text-xs text-[#D1D5DB]">
                <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
                <span>Deterministic pre-transaction kernel enforcement</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-[#D1D5DB]">
                <KeyRound className="w-4 h-4 text-[#3B82F6] shrink-0 mt-0.5" />
                <span>Ed25519 digitally signed intent mandates &amp; kill-switches</span>
              </div>
              <div className="flex items-start gap-2.5 text-xs text-[#D1D5DB]">
                <Zap className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
                <span>Real-time Cloud Firestore synchronization &amp; persistence</span>
              </div>
            </div>
          </div>

          <div className="relative z-10 pt-6 mt-6 border-t border-white/10 text-[11px] font-mono text-[#9CA3AF]">
            <span>Cloud Firestore Verified · SHA-256 Hash Chaining</span>
          </div>
        </div>

        {/* Right Auth Form Column */}
        <div className="md:col-span-7 p-6 sm:p-10 flex flex-col justify-center gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-[#111827] tracking-tight">
              {mode === "login" ? "Welcome back" : "Get started with Paybound"}
            </h1>
            <p className="text-xs text-[#6B7280]">
              {mode === "login"
                ? "Enter your credentials to manage active mandates and view audit ledgers."
                : "Create an account to configure custom spending caps and delegate agents."}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="flex items-start gap-2 bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] p-3 rounded-lg text-xs font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Social Sign In */}
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

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                    className="w-full pl-9 pr-3 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg text-sm text-[#111827] outline-none"
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
                  className="w-full pl-9 pr-3 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg text-sm text-[#111827] outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#374151]">Password</label>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] rounded-lg text-sm text-[#111827] outline-none"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="solid"
              size="md"
              disabled={loading}
              className="w-full justify-center py-2.5"
            >
              <span>{loading ? "Authenticating..." : mode === "login" ? "Sign In to Console" : "Create My Account"}</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </form>

          {/* Toggle mode */}
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
                  className="text-[#111827] font-semibold hover:underline cursor-pointer ml-1"
                >
                  Create one now
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
                  className="text-[#111827] font-semibold hover:underline cursor-pointer ml-1"
                >
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
