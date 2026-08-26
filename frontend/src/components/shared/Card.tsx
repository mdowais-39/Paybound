import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
  highlightBorder?: "none" | "green" | "amber" | "violet" | "rust" | "blue";
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  id,
  highlightBorder = "none",
}) => {
  const borderLeftClasses = {
    none: "",
    green: "border-l-4 border-l-[#10B981]",
    amber: "border-l-4 border-l-[#F59E0B]",
    violet: "border-l-4 border-l-[#7C3AED]",
    rust: "border-l-4 border-l-[#C2410C]",
    blue: "border-l-4 border-l-[#2563EB]",
  };

  return (
    <div
      id={id}
      className={`bg-white border border-[#E5E7EB] rounded-xl p-5 sm:p-6 shadow-xs transition-all ${borderLeftClasses[highlightBorder]} ${className}`}
    >
      {children}
    </div>
  );
};
