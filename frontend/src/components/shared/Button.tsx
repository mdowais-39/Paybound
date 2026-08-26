import React from "react";

export type ButtonVariant = "solid" | "outline" | "ghost";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: React.ReactNode;
  id?: string;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "solid",
  size = "md",
  loading = false,
  children,
  className = "",
  disabled,
  id,
  ...props
}) => {
  const sizeStyles = {
    sm: "px-3 py-1.5 text-xs font-medium min-h-[32px]",
    md: "px-4 py-2 text-sm font-medium min-h-[38px]",
    lg: "px-5 py-2.5 text-base font-medium min-h-[44px]",
  };

  const variantStyles = {
    solid:
      "bg-[#111827] hover:bg-[#1F2937] active:bg-[#374151] text-white border border-[#111827] shadow-xs",
    outline:
      "bg-white hover:bg-[#F9FAFB] active:bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB] shadow-xs",
    ghost:
      "bg-transparent hover:bg-[#F3F4F6] text-[#111827] border-transparent",
  };

  return (
    <button
      id={id}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : null}
      {children}
    </button>
  );
};
