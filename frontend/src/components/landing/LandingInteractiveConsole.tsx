import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  Cpu,
  Lock,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  FileText,
  Activity,
  ArrowRight,
  ExternalLink,
  Zap,
  Layers,
  Sparkles,
} from "lucide-react";

type TabMode = "flow" | "rules" | "audit";

export const LandingInteractiveConsole: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabMode>("flow");
  const [selectedNode, setSelectedNode] = useState<string>("kernel");
  const [testScenario, setTestScenario] = useState<"normal" | "injection" | "overcap" | "human_afa">("normal");

  const nodesInfo: Record<string, {
    title: string;
    type: string;
    badge: string;
    riskIndex: string;
    riskLevel: string;
    description: string;
    status: string;
    payload: Record<string, any>;
  }> = {
    payer: {
      title: "Payer Principal (Human User)",
      type: "AUTHENTICATED IDENTITY",
      badge: "Ed25519 SIGNED",
      riskIndex: "0.02 (Safe)",
      riskLevel: "safe",
      description: "Root authority granting scoped spending budget. Sets hard caps, category allowlists, and cryptographic time-to-live.",
      status: "Verified Authenticated Session",
      payload: {
        payer_id: "usr_owais_392",
        budget_total_paise: 1000000,
        per_txn_cap_paise: 600000,
        allowed_merchants: ["mer_demo_razorpay_store"],
        allowed_categories: ["footwear", "electronics", "home"],
      },
    },
    agent: {
      title: "Discovery & Shopping Copilot",
      type: "AUTONOMOUS WORKER",
      badge: "UNTRUSTED ENVIRONMENT",
      riskIndex: "0.84 (High Exposure)",
      riskLevel: "danger",
      description: "Autonomous LLM searching catalogs, parsing reviews, and building proposed carts. Subject to web injections and model hallucination.",
      status: "Sandboxed & Isolated",
      payload: {
        worker_id: "agent_gemini_copilot_v4",
        search_query: "Find running shoes under ₹3,000 with good arch support",
        proposed_item: "AirFlow Cushioning Running Shoes (₹2,998.00)",
        prompt_injection_isolated: true,
      },
    },
    kernel: {
      title: "Paybound Deterministic Kernel",
      type: "MATHEMATICAL GATE",
      badge: "RUST AXION ZERO-LLM",
      riskIndex: "0.00 (Zero Defect)",
      riskLevel: "safe",
      description: "Deterministic 9-rule enforcement engine. Evaluates cart bounds, spend limits, merchant allowlists, and AFA thresholds deterministically, without calling an LLM.",
      status: "All 9 Bounds Enforced",
      payload: {
        kernel: "rust (deterministic)",
        rules_checked: "9/9 verified",
        llm_calls: 0,
        verdict: "APPROVED_FOR_EXECUTION",
        afa_escalation: "Not required (< ₹15,000 threshold)",
      },
    },
    razorpay: {
      title: "Razorpay Test Rails",
      type: "EXECUTION PLANE",
      badge: "SECURE TEST LINK",
      riskIndex: "0.01 (Authorized)",
      riskLevel: "safe",
      description: "Payment effect layer creating single-use Razorpay payment links for verified carts. Raw credentials are never exposed to the AI agent.",
      status: "Ready for Checkout",
      payload: {
        payment_link_id: "plink_example",
        amount_paise: 299800,
        currency: "INR",
        mode: "TEST_MODE",
      },
    },
  };

  return (
    <section id="interactive-workspace" className="relative py-12 md:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        
        {/* Main Terminal / Console Container */}
        <div className="w-full bg-[#0B0F19] rounded-2xl border border-white/15 shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col">
          
          {/* Top Window Bar */}
          <div className="bg-[#07090E] px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              {/* Traffic Light Dots */}
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#EF4444]/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-[#F59E0B]/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-[#10B981]/80 inline-block" />
              </div>
              <span className="font-mono text-white/80 font-semibold tracking-wider">
                PAYBOUND CORE // WORKSPACE
              </span>
              <div className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#F59E0B]/10 border border-[#F59E0B]/30 font-mono text-[10px] text-[#FDE68A]">
                <span>ILLUSTRATIVE — NOT LIVE DATA</span>
              </div>
            </div>

            {/* Quick File Badges */}
            <div className="hidden md:flex items-center gap-2 font-mono text-[11px] text-[#9CA3AF]">
              <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 border border-white/10 text-white">
                <FileCode className="w-3 h-3 text-[#60A5FA]" />
                <span>mandate_signed.json</span>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 border border-white/10 text-white">
                <ShieldCheck className="w-3 h-3 text-[#34D399]" />
                <span>kernel_policy.rs</span>
              </div>
              <div className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 border border-white/10 text-white">
                <Activity className="w-3 h-3 text-[#FBBF24]" />
                <span>sha256_audit.log</span>
              </div>
            </div>
          </div>

          {/* Console Body: Left Sidebar + Center Canvas */}
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
            
            {/* Left Sidebar Dossier */}
            <div className="lg:col-span-4 bg-[#07090E]/60 border-b lg:border-b-0 lg:border-r border-white/10 p-5 sm:p-6 flex flex-col justify-between gap-6 font-sans">
              
              <div className="flex flex-col gap-5">
                {/* Mandate Meta */}
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    MANDATE DOSSIER
                  </div>
                  <h3 className="text-base font-bold text-white tracking-tight mt-0.5 font-['Plus_Jakarta_Sans',sans-serif]">
                    Enterprise Delegate - Alpha Loop
                  </h3>
                  <div className="font-mono text-[11px] text-[#9CA3AF]">
                    Ref: <span className="text-white">#MND-2026-09A</span>
                  </div>
                </div>

                {/* Identity Cards */}
                <div className="flex flex-col gap-2">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    ENTITIES IDENTIFIED
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10 text-xs">
                    <span className="text-white font-medium">Payer Principal</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#3B82F6]/20 text-[#93C5FD] border border-[#3B82F6]/30">
                      HUMAN AUTH
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10 text-xs">
                    <span className="text-white font-medium">Shopping Copilot v4</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#F59E0B]/20 text-[#FDE68A] border border-[#F59E0B]/30">
                      AGENT LLM
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10 text-xs">
                    <span className="text-white font-medium">Deterministic Rust Kernel</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#10B981]/20 text-[#A7F3D0] border border-[#10B981]/30">
                      ZERO-LLM GATE
                    </span>
                  </div>
                </div>

                {/* Spending Meter */}
                <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#9CA3AF] font-mono text-[10px] uppercase">Spend Cap Meter</span>
                    <span className="font-mono text-white text-xs font-semibold">₹2,998 / ₹10,000</span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#10B981] to-[#3B82F6] w-[30%]" />
                  </div>
                  <div className="flex justify-between items-center text-[10px] font-mono text-[#9CA3AF]">
                    <span>Per-Txn Cap: ₹6,000</span>
                    <span className="text-[#34D399]">30% Utilized</span>
                  </div>
                </div>

                {/* Kernel Findings Checklist */}
                <div className="flex flex-col gap-2">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    POLICY VERIFICATIONS
                  </div>
                  <div className="flex flex-col gap-1.5 text-xs text-[#D1D5DB]">
                    <div className="flex items-start gap-2 p-2 rounded bg-white/[0.02] border border-white/5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-white">Prompt Injection Immunity:</span>
                        <p className="text-[11px] text-[#9CA3AF]">LLM instructions never touch execution kernels.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded bg-white/[0.02] border border-white/5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-white">Hard Budget Enforcement:</span>
                        <p className="text-[11px] text-[#9CA3AF]">Exceeding ₹6,000 per txn triggers instant refusal.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 p-2 rounded bg-white/[0.02] border border-white/5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-white">Cryptographic Provenance:</span>
                        <p className="text-[11px] text-[#9CA3AF]">Every evaluation SHA-256 hashed sequentially.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action */}
              <Link
                to="/mandate"
                className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-center text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Open in Live Mandate Engine</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* Center Stage Workspace */}
            <div className="lg:col-span-8 p-5 sm:p-6 flex flex-col justify-between gap-6 bg-[#0B0F19]">
              
              {/* Tab Navigation Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setActiveTab("flow")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      activeTab === "flow"
                        ? "bg-white text-[#07090E] shadow-sm font-semibold"
                        : "text-[#9CA3AF] hover:text-white"
                    }`}
                  >
                    Asset Flow Network
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("rules")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      activeTab === "rules"
                        ? "bg-white text-[#07090E] shadow-sm font-semibold"
                        : "text-[#9CA3AF] hover:text-white"
                    }`}
                  >
                    Analyst Copilot &amp; Rules
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("audit")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      activeTab === "audit"
                        ? "bg-white text-[#07090E] shadow-sm font-semibold"
                        : "text-[#9CA3AF] hover:text-white"
                    }`}
                  >
                    Investigation Report (Audit)
                  </button>
                </div>

                <div className="font-mono text-[11px] text-[#9CA3AF] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                  <span>DETERMINISTIC CAPITAL TOPOLOGY</span>
                </div>
              </div>

              {/* Tab 1: Flow Network Diagram (FinIntel style node web) */}
              {activeTab === "flow" && (
                <div className="flex flex-col gap-6">
                  {/* Interactive Nodes Canvas */}
                  <div className="relative min-h-[260px] rounded-xl bg-[#07090E]/80 border border-white/10 p-6 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden">
                    {/* Connecting decorative wire lines */}
                    <div className="absolute top-1/2 left-12 right-12 h-0.5 bg-gradient-to-r from-[#3B82F6]/30 via-[#10B981]/50 to-[#3B82F6]/30 -translate-y-1/2 hidden md:block" />
                    
                    {/* Node 1: Payer */}
                    <button
                      type="button"
                      onClick={() => setSelectedNode("payer")}
                      className={`relative z-10 w-full md:w-48 p-4 rounded-xl text-left border transition-all cursor-pointer ${
                        selectedNode === "payer"
                          ? "bg-white/10 border-white ring-2 ring-white/20 shadow-xl"
                          : "bg-white/5 border-white/10 hover:border-white/30"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#9CA3AF] mb-1">
                        <span>HUMAN</span>
                        <span className="text-[#60A5FA]">ROOT</span>
                      </div>
                      <div className="text-xs font-bold text-white">Payer Principal</div>
                      <div className="font-mono text-[11px] text-[#9CA3AF] mt-1">₹10,000 Signed Mandate</div>
                    </button>

                    {/* Node 2: Agent */}
                    <button
                      type="button"
                      onClick={() => setSelectedNode("agent")}
                      className={`relative z-10 w-full md:w-48 p-4 rounded-xl text-left border transition-all cursor-pointer ${
                        selectedNode === "agent"
                          ? "bg-white/10 border-white ring-2 ring-white/20 shadow-xl"
                          : "bg-white/5 border-white/10 hover:border-white/30"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#9CA3AF] mb-1">
                        <span>UNTRUSTED</span>
                        <span className="text-[#F59E0B]">AI AGENT</span>
                      </div>
                      <div className="text-xs font-bold text-white">Shopping Copilot</div>
                      <div className="font-mono text-[11px] text-[#9CA3AF] mt-1">Proposes Cart</div>
                    </button>

                    {/* Node 3: Kernel (Featured Central Gateway) */}
                    <button
                      type="button"
                      onClick={() => setSelectedNode("kernel")}
                      className={`relative z-10 w-full md:w-56 p-4 rounded-xl text-left border transition-all cursor-pointer ${
                        selectedNode === "kernel"
                          ? "bg-gradient-to-br from-white/15 to-[#10B981]/15 border-[#10B981] ring-2 ring-[#10B981]/30 shadow-2xl"
                          : "bg-white/5 border-white/10 hover:border-[#10B981]/50"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                        <span className="text-[#34D399] font-semibold">DETERMINISTIC GATE</span>
                        <span className="px-1.5 py-0.2 rounded bg-[#10B981]/20 text-[#A7F3D0]">9 RULES</span>
                      </div>
                      <div className="text-xs font-bold text-white flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4 text-[#10B981]" />
                        <span>Paybound Kernel</span>
                      </div>
                      <div className="font-mono text-[11px] text-[#34D399] mt-1">LLM-Free Gating</div>
                    </button>

                    {/* Node 4: Razorpay */}
                    <button
                      type="button"
                      onClick={() => setSelectedNode("razorpay")}
                      className={`relative z-10 w-full md:w-48 p-4 rounded-xl text-left border transition-all cursor-pointer ${
                        selectedNode === "razorpay"
                          ? "bg-white/10 border-white ring-2 ring-white/20 shadow-xl"
                          : "bg-white/5 border-white/10 hover:border-white/30"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#9CA3AF] mb-1">
                        <span>EXECUTION</span>
                        <span className="text-[#3B82F6]">SETTLEMENT</span>
                      </div>
                      <div className="text-xs font-bold text-white">Razorpay Rails</div>
                      <div className="font-mono text-[11px] text-[#9CA3AF] mt-1">Single-Use Link</div>
                    </button>
                  </div>

                  {/* Node Inspector Dossier Card */}
                  <div className="rounded-xl bg-[#07090E] border border-white/15 p-5 flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                      <div>
                        <span className="text-[10px] font-mono uppercase text-[#9CA3AF]">
                          NODE DOSSIER // {nodesInfo[selectedNode].type}
                        </span>
                        <h4 className="text-base font-bold text-white font-['Plus_Jakarta_Sans',sans-serif]">
                          {nodesInfo[selectedNode].title}
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-white/10 text-white border border-white/10">
                          {nodesInfo[selectedNode].badge}
                        </span>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#10B981]/20 text-[#A7F3D0] border border-[#10B981]/30">
                          {nodesInfo[selectedNode].status}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-[#9CA3AF] leading-relaxed">
                      {nodesInfo[selectedNode].description}
                    </p>

                    {/* Code / Payload Viewer */}
                    <div className="bg-[#05070B] rounded-lg p-3 border border-white/5 font-mono text-[11px] text-[#D1D5DB] overflow-x-auto">
                      <pre>{JSON.stringify(nodesInfo[selectedNode].payload, null, 2)}</pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: 9-Rule Deterministic Policy Table */}
              {activeTab === "rules" && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-[#9CA3AF]">
                      A conceptual walkthrough of how the 9 hard rules evaluate for different scenarios (illustrative, not live):
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTestScenario("normal")}
                        className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                          testScenario === "normal"
                            ? "bg-[#10B981]/20 text-[#A7F3D0] border border-[#10B981]/40"
                            : "bg-white/5 text-[#9CA3AF] hover:text-white"
                        }`}
                      >
                        Valid Item (₹2,998)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTestScenario("overcap")}
                        className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                          testScenario === "overcap"
                            ? "bg-[#EF4444]/20 text-[#FCA5A5] border border-[#EF4444]/40"
                            : "bg-white/5 text-[#9CA3AF] hover:text-white"
                        }`}
                      >
                        Over Cap (₹8,499)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTestScenario("human_afa")}
                        className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                          testScenario === "human_afa"
                            ? "bg-[#F59E0B]/20 text-[#FDE68A] border border-[#F59E0B]/40"
                            : "bg-white/5 text-[#9CA3AF] hover:text-white"
                        }`}
                      >
                        High Value (₹18,500)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-[#9CA3AF]">RULE 01 &amp; 02</span>
                      <span className="text-xs font-bold text-white">Mandate TTL &amp; Kill-Switch</span>
                      <span className="font-mono text-[11px] text-[#34D399]">PASS (Mandate Active)</span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-[#9CA3AF]">RULE 03 &amp; 04</span>
                      <span className="text-xs font-bold text-white">Merchant &amp; Category Filter</span>
                      <span className="font-mono text-[11px] text-[#34D399]">PASS (Razorpay Store / Shoes)</span>
                    </div>

                    <div className={`p-3.5 rounded-xl border flex flex-col gap-1 ${
                      testScenario === "overcap"
                        ? "bg-[#EF4444]/10 border-[#EF4444]/40"
                        : "bg-white/[0.02] border-white/10"
                    }`}>
                      <span className="font-mono text-[10px] text-[#9CA3AF]">RULE 05 // TXN CAP</span>
                      <span className="text-xs font-bold text-white">Per-Txn Cap (₹6,000 Max)</span>
                      <span className={`font-mono text-[11px] ${
                        testScenario === "overcap" ? "text-[#EF4444] font-bold" : "text-[#34D399]"
                      }`}>
                        {testScenario === "overcap" ? "FAIL // REFUSED (> ₹6,000)" : "PASS (₹2,998 ≤ ₹6,000)"}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-[#9CA3AF]">RULE 06 &amp; 07</span>
                      <span className="text-xs font-bold text-white">Total Budget &amp; Quantity</span>
                      <span className="font-mono text-[11px] text-[#34D399]">PASS (Qty 1 / Within ₹10k)</span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-[#9CA3AF]">RULE 08</span>
                      <span className="text-xs font-bold text-white">Price Anomaly Sanity</span>
                      <span className="font-mono text-[11px] text-[#34D399]">PASS (Market price aligned)</span>
                    </div>

                    <div className={`p-3.5 rounded-xl border flex flex-col gap-1 ${
                      testScenario === "human_afa"
                        ? "bg-[#F59E0B]/10 border-[#F59E0B]/40"
                        : "bg-white/[0.02] border-white/10"
                    }`}>
                      <span className="font-mono text-[10px] text-[#9CA3AF]">RULE 09 // AFA ESCALATION</span>
                      <span className="text-xs font-bold text-white">Human PIN Threshold (&gt; ₹15k)</span>
                      <span className={`font-mono text-[11px] ${
                        testScenario === "human_afa" ? "text-[#F59E0B] font-bold" : "text-[#34D399]"
                      }`}>
                        {testScenario === "human_afa" ? "NEEDS_HUMAN_PIN (₹18,500)" : "PASS (Auto-Approved)"}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between text-xs">
                    <span className="text-white font-medium">Final Evaluation Verdict:</span>
                    <span className={`font-mono font-bold px-3 py-1 rounded ${
                      testScenario === "overcap"
                        ? "bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/30"
                        : testScenario === "human_afa"
                        ? "bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30"
                        : "bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/30"
                    }`}>
                      {testScenario === "overcap" ? "VERDICT: REFUSED" : testScenario === "human_afa" ? "VERDICT: NEEDS_HUMAN_AFA" : "VERDICT: APPROVED"}
                    </span>
                  </div>
                </div>
              )}

              {/* Tab 3: SHA-256 Audit Trail */}
              {activeTab === "audit" && (
                <div className="flex flex-col gap-3 font-mono text-xs">
                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                      <span className="text-white font-semibold">BLOCK #01: SESSION INITIALIZATION</span>
                    </div>
                    <span className="text-[#9CA3AF] text-[11px]">8f7e6d5c...fedc</span>
                  </div>

                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#3B82F6]" />
                      <span className="text-white font-semibold">BLOCK #02: DISCOVERY WORKER DISPATCHED</span>
                    </div>
                    <span className="text-[#9CA3AF] text-[11px]">9a8b7c6d...3e2f</span>
                  </div>

                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                      <span className="text-white font-semibold">BLOCK #03: KERNEL DETERMINISTIC VERDICT (9/9 PASS)</span>
                    </div>
                    <span className="text-[#9CA3AF] text-[11px]">4e5f6a7b...8c9d</span>
                  </div>

                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                      <span className="text-white font-semibold">BLOCK #04: RAZORPAY TEST LINK GENERATED</span>
                    </div>
                    <span className="text-[#9CA3AF] text-[11px]">1a2b3c4d...5e6f</span>
                  </div>
                </div>
              )}

              {/* Status Footer Line */}
              <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#9CA3AF]">
                <span>Illustrative walkthrough of the deterministic path.</span>
                <Link to="/shop" className="text-[#60A5FA] hover:underline inline-flex items-center gap-1">
                  <span>See the live console →</span>
                </Link>
              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
