import React from "react";
import {
  Check,
  Loader2,
  AlertCircle,
  Shield,
  ShieldCheck,
  Cpu,
  Search,
  Layers,
  ShieldAlert,
  CreditCard,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { PipelineStageState } from "../../lib/types";

interface PipelineStepperProps {
  stages: PipelineStageState[];
  currentStepIndex: number;
  isComplete: boolean;
  verdict?: "approved" | "refused" | "needs_human" | "clarify" | null;
  id?: string;
}

interface StageMeta {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}

const STAGE_CONFIGS: Record<string, StageMeta> = {
  pre_checks: {
    id: "pre_checks",
    title: "Pre-Checks",
    subtitle: "Signature & guard",
    category: "SOURCE",
    icon: ShieldCheck,
    iconBg: "bg-[#FAF5FF] border border-[#DDD6FE]",
    iconColor: "text-[#7C3AED]",
  },
  parsing: {
    id: "parsing",
    title: "Intent Parsing",
    subtitle: "Extract bounds",
    category: "ACTION",
    icon: Cpu,
    iconBg: "bg-[#EFF6FF] border border-[#BFDBFE]",
    iconColor: "text-[#2563EB]",
  },
  searching: {
    id: "searching",
    title: "Catalog Match",
    subtitle: "Merchant search",
    category: "ACTION",
    icon: Search,
    iconBg: "bg-[#FFFBEB] border border-[#FDE68A]",
    iconColor: "text-[#D97706]",
  },
  composing: {
    id: "composing",
    title: "Cart Composer",
    subtitle: "Line items & total",
    category: "ACTION",
    icon: Layers,
    iconBg: "bg-[#F0FDFA] border border-[#99F6E4]",
    iconColor: "text-[#0D9488]",
  },
  kernel_gate: {
    id: "kernel_gate",
    title: "Kernel Gate",
    subtitle: "9 bound checks",
    category: "GATE KERNEL",
    icon: ShieldAlert,
    iconBg: "bg-[#FEF2F2] border border-[#FECACA]",
    iconColor: "text-[#DC2626]",
  },
  outcome: {
    id: "outcome",
    title: "Settlement Rails",
    subtitle: "Payment dispatch",
    category: "ACTION",
    icon: CreditCard,
    iconBg: "bg-[#ECFDF5] border border-[#A7F3D0]",
    iconColor: "text-[#059669]",
  },
};

export const PipelineStepper: React.FC<PipelineStepperProps> = ({
  stages,
  currentStepIndex,
  isComplete,
  verdict,
  id,
}) => {
  return (
    <div
      id={id || "pipeline-progress-graph-container"}
      className="bg-white border border-[#E5E7EB] rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col gap-4"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xs uppercase tracking-wider text-[#111827] font-bold">
            EXECUTION PIPELINE
          </span>
          <span className="hidden sm:inline text-xs text-[#6B7280]">
            · Deterministic node graph & cryptographic gates
          </span>
        </div>

        <div className="font-mono text-xs">
          {isComplete ? (
            verdict === "refused" ? (
              <span className="inline-flex items-center gap-1.5 font-bold text-[#D97706] bg-[#FFFBEB] border border-[#FDE68A] px-2.5 py-0.5 rounded-full">
                <AlertCircle className="w-3.5 h-3.5" />
                Gate Refused
              </span>
            ) : verdict === "needs_human" ? (
              <span className="inline-flex items-center gap-1.5 font-bold text-[#7C3AED] bg-[#FAF5FF] border border-[#DDD6FE] px-2.5 py-0.5 rounded-full">
                <Shield className="w-3.5 h-3.5" />
                Human AFA Required
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-bold text-[#059669] bg-[#ECFDF5] border border-[#A7F3D0] px-2.5 py-0.5 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Execution Complete
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1.5 font-bold text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-0.5 rounded-full">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Evaluating Node {currentStepIndex + 1} of {stages.length}...
            </span>
          )}
        </div>
      </div>

      {/* Interactive Dot-Grid Canvas with Connected Progress Nodes */}
      <div className="relative w-full rounded-xl bg-[#F8FAFC] bg-[radial-gradient(#CBD5E1_1.2px,transparent_1.2px)] [background-size:18px_18px] border border-[#E2E8F0] p-5 sm:p-6 overflow-x-auto scrollbar-thin">
        <div className="flex items-center min-w-max py-2 px-1">
          {stages.map((stage, idx) => {
            const config = STAGE_CONFIGS[stage.id] || {
              id: stage.id,
              title: stage.label,
              subtitle: "Processing step",
              category: "ACTION",
              icon: Sparkles,
              iconBg: "bg-[#F3F4F6] border border-[#E5E7EB]",
              iconColor: "text-[#4B5563]",
            };

            const Icon = config.icon;
            const isPassed =
              idx < currentStepIndex || (isComplete && stage.status === "success");
            const isActive = idx === currentStepIndex && !isComplete;
            const isFailed = stage.status === "refused";
            const isNeedsHuman = stage.status === "needs_human";
            const isIdle = !isPassed && !isActive && !isFailed && !isNeedsHuman;
            const isLast = idx === stages.length - 1;

            // Compute card border & highlight state
            let cardBorder = "border-[#E2E8F0] hover:border-[#CBD5E1]";
            let cardBg = "bg-white";
            let portColor = "bg-[#94A3B8]";

            if (isFailed) {
              cardBorder = "border-[#D97706] ring-2 ring-[#FDE68A]/60";
              cardBg = "bg-[#FFFDF5]";
              portColor = "bg-[#D97706]";
            } else if (isNeedsHuman) {
              cardBorder = "border-[#7C3AED] ring-2 ring-[#DDD6FE]/60";
              cardBg = "bg-[#FDFBFF]";
              portColor = "bg-[#7C3AED]";
            } else if (isActive) {
              cardBorder = "border-[#2563EB] ring-2 ring-[#93C5FD]/60 shadow-md";
              cardBg = "bg-white";
              portColor = "bg-[#2563EB]";
            } else if (isPassed) {
              cardBorder = "border-[#10B981] ring-1 ring-[#10B981]/20";
              portColor = "bg-[#10B981]";
            }

            return (
              <React.Fragment key={stage.id}>
                {/* Node Card Component */}
                <div
                  id={`pipeline-node-${stage.id}`}
                  className={`w-[215px] h-[98px] rounded-2xl ${cardBg} border ${cardBorder} shadow-xs p-3.5 flex flex-col justify-between relative shrink-0 transition-all duration-200 group`}
                >
                  {/* Left Connection Port Dot */}
                  <span
                    className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white ${portColor} shadow-2xs z-20 transition-colors`}
                  />

                  {/* Right Connection Port Dot */}
                  <span
                    className={`absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white ${portColor} shadow-2xs z-20 transition-colors`}
                  />

                  {/* Card Header (Icon + Title + Subtitle) */}
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${config.iconBg} ${config.iconColor}`}
                    >
                      <Icon className="w-4 h-4 stroke-[2.2]" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-bold text-[#0F172A] truncate">
                        {config.title}
                      </h4>
                      <p className="text-[11px] text-[#64748B] truncate mt-0.5">
                        {config.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Card Footer (Category Tag + Status Label) */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#F1F5F9] text-[10px] font-mono">
                    <span className="font-bold text-[#94A3B8] uppercase tracking-wider">
                      {config.category}
                    </span>

                    {/* Status Pill / Text */}
                    {isPassed ? (
                      <span className="text-[#059669] font-bold flex items-center gap-1">
                        <Check className="w-3 h-3 stroke-[3]" />
                        <span>Done</span>
                      </span>
                    ) : isActive ? (
                      <span className="text-[#2563EB] font-bold flex items-center gap-1 animate-pulse">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Running</span>
                      </span>
                    ) : isFailed ? (
                      <span className="text-[#D97706] font-bold flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        <span>Refused</span>
                      </span>
                    ) : isNeedsHuman ? (
                      <span className="text-[#7C3AED] font-bold flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        <span>Needs AFA</span>
                      </span>
                    ) : (
                      <span className="text-[#94A3B8] font-medium">Idle</span>
                    )}
                  </div>
                </div>

                {/* Connecting Wire & Junction between nodes */}
                {!isLast && (
                  <div className="w-7 sm:w-9 h-[2px] bg-[#CBD5E1] shrink-0 relative flex items-center justify-center">
                    {/* Pulsing travel signal when active */}
                    {isPassed && (
                      <div className="absolute inset-0 bg-[#10B981] transition-all" />
                    )}
                    {isActive && (
                      <div className="absolute h-full w-1/2 bg-[#2563EB] animate-pulse" />
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Kernel Gate Cryptographic Guarantee Sub-footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs font-mono text-[#6B7280] pt-1 gap-1.5">
        <div className="flex items-center gap-1.5 text-[#DC2626] font-medium">
          <Shield className="w-3.5 h-3.5 shrink-0" />
          <span>Rust Mandate Kernel: 9 deterministic bounds evaluated at GATE node</span>
        </div>
        <span className="text-[#9CA3AF]">Zero LLM token leakage at policy boundary</span>
      </div>
    </div>
  );
};
