import React from "react";

export const TestModeBanner: React.FC = () => {
  return (
    <div
      id="test-mode-banner"
      className="w-full bg-[#111827] text-white py-1.5 px-4 text-center font-mono text-[11px] tracking-wider uppercase select-none border-b border-[#1F2937]"
    >
      <span className="opacity-80">Razorpay Test Mode</span> · <span className="text-[#9CA3AF]">real API calls, simulation sandbox</span>
    </div>
  );
};
