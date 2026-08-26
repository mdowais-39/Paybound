import React, { useState, useMemo } from "react";
import { Pill } from "../shared/Pill";
import { paiseToRupees } from "../../lib/money";
import { PipelineStageState, OrchestratorResult } from "../../lib/types";
import {
  ShoppingBag,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  Clock,
  ChevronRight,
  Filter,
  Trash2,
} from "lucide-react";

export interface CartSession {
  id: string;
  cartId: string;
  goal: string;
  title: string;
  timestamp: string;
  stages: PipelineStageState[];
  currentStepIndex: number;
  isComplete: boolean;
  result: OrchestratorResult | null;
  amountPaise: number;
  /** The human declined a NEEDS_HUMAN purchase — a local UI action (there is
   * no backend "decline"; declining simply means never approving). No
   * fabricated verdict is invented for it. */
  declined?: boolean;
  /** Set when the backend call itself failed, so the UI can show an honest
   * error instead of a fabricated outcome. */
  error?: string | null;
}

interface CartListProps {
  carts: CartSession[];
  selectedCartId: string | null;
  onSelectCart: (id: string) => void;
  onNewCart: () => void;
  onDeleteCart?: (id: string) => void;
}

export const CartList: React.FC<CartListProps> = ({
  carts,
  selectedCartId,
  onSelectCart,
  onNewCart,
  onDeleteCart,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "refused" | "needs_human">("all");

  const counts = useMemo(() => {
    let approved = 0;
    let refused = 0;
    let needsHuman = 0;

    carts.forEach((c) => {
      const state = c.result?.state;
      const verdict = c.result?.verdict;
      if (state === "AUTHORIZED" || state === "COMPLETED" || verdict === "approved") {
        approved++;
      } else if (state === "REFUSED" || state === "PRE_CHECK_FAILED" || verdict === "refused") {
        refused++;
      } else if (state === "NEEDS_HUMAN" || verdict === "needs_human") {
        needsHuman++;
      }
    });

    return { total: carts.length, approved, refused, needsHuman };
  }, [carts]);

  const filteredCarts = useMemo(() => {
    return carts.filter((c) => {
      // 1. Status match
      if (statusFilter !== "all") {
        const state = c.result?.state;
        const verdict = c.result?.verdict;
        const isApproved = state === "AUTHORIZED" || state === "COMPLETED" || verdict === "approved";
        const isRefused = state === "REFUSED" || state === "PRE_CHECK_FAILED" || verdict === "refused";
        const isNeedsHuman = state === "NEEDS_HUMAN" || verdict === "needs_human";

        if (statusFilter === "approved" && !isApproved) return false;
        if (statusFilter === "refused" && !isRefused) return false;
        if (statusFilter === "needs_human" && !isNeedsHuman) return false;
      }

      // 2. Search query match
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        c.goal.toLowerCase().includes(q) ||
        c.cartId.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [carts, statusFilter, searchQuery]);

  return (
    <div
      id="cart-selector-sidebar"
      className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs flex flex-col h-full overflow-hidden"
    >
      {/* 1. Header & New Cart Action */}
      <div className="p-4 border-b border-[#E5E7EB] flex items-center justify-between gap-2 bg-[#FAFBFD]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#111827] text-white flex items-center justify-center shadow-xs">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#111827]">Purchase Carts</h3>
            <span className="font-mono text-[11px] text-[#6B7280]">
              {carts.length} {carts.length === 1 ? "session" : "sessions"} recorded
            </span>
          </div>
        </div>

        <button
          type="button"
          id="btn-create-new-cart"
          onClick={onNewCart}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#111827] hover:bg-[#1F2937] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          title="Create a new purchase cart"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Cart</span>
        </button>
      </div>

      {/* 2. Search & Filters Bar */}
      <div className="p-3 border-b border-[#E5E7EB] flex flex-col gap-2.5 bg-white">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            id="input-cart-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search carts, items, goals..."
            className="w-full pl-8 pr-3 py-1.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-[#111827] focus:bg-white transition-colors"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-[11px] font-medium font-mono">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === "all"
                ? "bg-[#111827] text-white"
                : "bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]"
            }`}
          >
            All ({counts.total})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("approved")}
            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === "approved"
                ? "bg-[#059669] text-white"
                : "bg-[#ECFDF5] text-[#059669] hover:bg-[#D1FAE5]"
            }`}
          >
            Auth ({counts.approved})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("refused")}
            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === "refused"
                ? "bg-[#D97706] text-white"
                : "bg-[#FFFBEB] text-[#D97706] hover:bg-[#FEF3C7]"
            }`}
          >
            Refused ({counts.refused})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("needs_human")}
            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              statusFilter === "needs_human"
                ? "bg-[#7C3AED] text-white"
                : "bg-[#FAF5FF] text-[#7C3AED] hover:bg-[#F3E8FF]"
            }`}
          >
            Review ({counts.needsHuman})
          </button>
        </div>
      </div>

      {/* 3. Carts Scrollable List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#E5E7EB] bg-[#FDFDFE]">
        {filteredCarts.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center">
            <ShoppingBag className="w-8 h-8 text-[#D1D5DB] mb-2" />
            <p className="text-xs font-semibold text-[#374151]">No carts found</p>
            <p className="text-[11px] text-[#9CA3AF] mt-1 max-w-[200px]">
              {searchQuery
                ? "No carts match your search filter."
                : "Enter a goal below or click 'New Cart' to start."}
            </p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="mt-3 text-xs font-mono text-[#2563EB] hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          filteredCarts.map((cart) => {
            const isSelected = cart.id === selectedCartId;
            const isApproved =
              cart.result?.state === "AUTHORIZED" ||
              cart.result?.state === "COMPLETED" ||
              cart.result?.verdict === "approved";
            const isRefused =
              cart.result?.state === "REFUSED" ||
              cart.result?.state === "PRE_CHECK_FAILED" ||
              cart.result?.verdict === "refused";
            const isNeedsHuman =
              cart.result?.state === "NEEDS_HUMAN" || cart.result?.verdict === "needs_human";
            const isEvaluating = !cart.isComplete;

            return (
              <div
                key={cart.id}
                id={`cart-item-${cart.id}`}
                onClick={() => onSelectCart(cart.id)}
                className={`p-3.5 transition-all cursor-pointer relative group flex flex-col gap-2 rounded-r-xl my-1 mx-1 ${
                  isSelected
                    ? "bg-[#F3F4F6] border-l-4 border-l-[#111827] shadow-sm ring-1 ring-[#E5E7EB]"
                    : "hover:bg-[#F9FAFB] border-l-4 border-l-transparent"
                }`}
              >
                {/* Top: Status Pill + Time */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {isEvaluating ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#2563EB] border border-[#DBEAFE]">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        Evaluating
                      </span>
                    ) : isApproved ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Authorized
                      </span>
                    ) : isRefused ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Refused
                      </span>
                    ) : isNeedsHuman ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#FAF5FF] text-[#7C3AED] border border-[#DDD6FE]">
                        <ShieldAlert className="w-2.5 h-2.5" />
                        AFA Review
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280]">
                        Clarify
                      </span>
                    )}

                    <span className="font-mono text-[10px] text-[#9CA3AF] truncate max-w-[90px]">
                      {cart.cartId.replace("crt_", "CRT-").substring(0, 12)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-[#111827] animate-pulse" title="Currently Selected" />
                    )}
                    <span className="font-mono text-[10px] text-[#9CA3AF] whitespace-nowrap">
                      {new Date(cart.timestamp).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>

                {/* Title & Goal preview */}
                <div>
                  <h4 className={`text-xs font-bold line-clamp-1 ${isSelected ? "text-[#111827]" : "text-[#374151] group-hover:text-[#111827]"}`}>
                    {cart.title}
                  </h4>
                  <p className="text-[11px] text-[#6B7280] line-clamp-1 italic mt-0.5">
                    "{cart.goal}"
                  </p>
                </div>

                {/* Amount & Items count */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-[#E5E7EB]/60">
                  <span className="font-mono font-bold text-[#111827] tabular-nums">
                    {paiseToRupees(cart.amountPaise)}
                  </span>

                  <div className="flex items-center gap-1.5 font-mono text-[11px]">
                    <span className="text-[#6B7280]">
                      {cart.result?.cart?.line_items?.length || 1}{" "}
                      {(cart.result?.cart?.line_items?.length || 1) === 1 ? "item" : "items"}
                    </span>
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                        isSelected
                          ? "bg-[#111827] text-white"
                          : "bg-[#F3F4F6] text-[#9CA3AF] group-hover:bg-[#E5E7EB] group-hover:text-[#111827]"
                      }`}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
