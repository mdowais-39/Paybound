import React from "react";

export type PillVariant = "green" | "amber" | "violet" | "slate" | "rust";

interface PillProps {
  variant?: PillVariant;
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export const Pill: React.FC<PillProps> = ({
  variant = "slate",
  children,
  className = "",
  id,
}) => {
  const variantStyles: Record<PillVariant, string> = {
    green: "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]",
    amber: "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]",
    violet: "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",
    slate: "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]",
    rust: "bg-[#FFF7ED] text-[#C2410C] border-[#FFEDD5]",
  };

  return (
    <span
      id={id}
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.03em] px-2.5 py-0.5 rounded-full border ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
};
