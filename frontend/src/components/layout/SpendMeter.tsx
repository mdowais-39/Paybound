import React from "react";
import { paiseToRupees } from "../../lib/money";

interface SpendMeterProps {
  usedPaise: number;
  totalPaise: number;
  compact?: boolean;
  showLabels?: boolean;
  className?: string;
  id?: string;
}

export const SpendMeter: React.FC<SpendMeterProps> = ({
  usedPaise = 0,
  totalPaise = 1,
  compact = false,
  showLabels = true,
  className = "",
  id,
}) => {
  const safeTotal = Math.max(totalPaise, 1);
  const safeUsed = Math.max(0, usedPaise);
  const percentage = Math.min(100, Math.max(0, (safeUsed / safeTotal) * 100));

  if (compact) {
    return (
      <div id={id} className={`inline-flex items-center gap-2 ${className}`}>
        <div className="w-16 h-2 bg-[#F3F4F6] border border-[#E5E7EB] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#10B981] transition-all duration-300 rounded-full"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div id={id} className={`flex flex-col gap-1.5 w-full ${className}`}>
      {showLabels && (
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-[#111827] font-semibold tabular-nums">
            {paiseToRupees(safeUsed)} <span className="text-[#6B7280] font-normal">of</span> {paiseToRupees(safeTotal)} <span className="text-[#6B7280] font-normal">used</span>
          </span>
          <span className="text-[#9CA3AF] tabular-nums text-[11px] font-medium">
            {percentage.toFixed(0)}%
          </span>
        </div>
      )}
      <div className="w-full h-2 bg-[#F3F4F6] border border-[#E5E7EB] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#10B981] transition-all duration-300 rounded-full"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
