import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useMandate } from "../context/MandateContext";
import { CartList, CartSession } from "../components/shop/CartList";
import { CartDetailView } from "../components/shop/CartDetailView";
import { GoalInput } from "../components/shop/GoalInput";
import { Pill } from "../components/shared/Pill";
import { SpendMeter } from "../components/layout/SpendMeter";
import { runAgentStream, selectOptionStream, approveSession, listRuns, deleteRun } from "../lib/api";
import { PipelineStageState, OrchestratorResult, SessionOutcome } from "../lib/types";
import {
  loadCarts,
  saveCarts,
  loadSelectedCartId,
  saveSelectedCartId,
} from "../lib/cartStore";
import { ShoppingBag } from "lucide-react";

// The pipeline stepper is driven by the REAL orchestrator result — it reflects
// how far the actual pipeline got, not a timed animation. (Phase 4 upgrades
// this to a live per-stage stream; until then it resolves from the final
// result, which is honest: every stage shown as "done" genuinely ran.)
const STAGE_LABELS: Record<PipelineStageState["id"], string> = {
  pre_checks: "Pre-checks",
  parsing: "Parsing",
  searching: "Searching",
  composing: "Composing",
  kernel_gate: "Kernel Gate",
  outcome: "Outcome",
};

function stage(id: PipelineStageState["id"], status: PipelineStageState["status"]): PipelineStageState {
  return { id, label: STAGE_LABELS[id], status };
}

const PENDING_STAGES: PipelineStageState[] = [
  stage("pre_checks", "active"),
  stage("parsing", "idle"),
  stage("searching", "idle"),
  stage("composing", "idle"),
  stage("kernel_gate", "idle"),
  stage("outcome", "idle"),
];

/** Resolve the six pipeline nodes from the terminal orchestrator state — how
 * far the real pipeline actually got. */
function stagesForState(state: SessionOutcome): PipelineStageState[] {
  const S = (s: PipelineStageState["status"]) => s;
  switch (state) {
    case "PRE_CHECK_FAILED":
      return [
        stage("pre_checks", S("refused")),
        stage("parsing", "idle"),
        stage("searching", "idle"),
        stage("composing", "idle"),
        stage("kernel_gate", "idle"),
        stage("outcome", "idle"),
      ];
    case "CLARIFY":
      return [
        stage("pre_checks", "success"),
        stage("parsing", "success"),
        stage("searching", "success"),
        stage("composing", "idle"),
        stage("kernel_gate", "idle"),
        stage("outcome", "idle"),
      ];
    case "CHOOSE":
      return [
        stage("pre_checks", "success"),
        stage("parsing", "success"),
        stage("searching", "success"),
        stage("composing", "idle"),
        stage("kernel_gate", "idle"),
        stage("outcome", "idle"),
      ];
    case "REFUSED":
      return [
        stage("pre_checks", "success"),
        stage("parsing", "success"),
        stage("searching", "success"),
        stage("composing", "success"),
        stage("kernel_gate", "refused"),
        stage("outcome", "idle"),
      ];
    case "NEEDS_HUMAN":
      return [
        stage("pre_checks", "success"),
        stage("parsing", "success"),
        stage("searching", "success"),
        stage("composing", "success"),
        stage("kernel_gate", "needs_human"),
        stage("outcome", "idle"),
      ];
    case "AUTHORIZED":
    case "COMPLETED":
      return [
        stage("pre_checks", "success"),
        stage("parsing", "success"),
        stage("searching", "success"),
        stage("composing", "success"),
        stage("kernel_gate", "success"),
        stage("outcome", "success"),
      ];
    default:
      return PENDING_STAGES;
  }
}

function verdictForStepper(state: SessionOutcome): "approved" | "refused" | "needs_human" | "clarify" | null {
  if (state === "AUTHORIZED" || state === "COMPLETED") return "approved";
  if (state === "REFUSED" || state === "PRE_CHECK_FAILED") return "refused";
  if (state === "NEEDS_HUMAN") return "needs_human";
  if (state === "CLARIFY" || state === "CHOOSE") return "clarify";
  return null;
}

/** Build a completed CartSession from a real OrchestratorResult — the single
 * source for both a finished live run and a run rehydrated from the DB, so both
 * render identically. */
function cartFromResult(
  id: string,
  goal: string,
  timestamp: string,
  result: OrchestratorResult,
): CartSession {
  const stages = stagesForState(result.state);
  const resolved = stages.filter((s) => s.status !== "idle").length;
  return {
    id,
    cartId: result.cart_id ?? "",
    goal,
    title: titleForResult(result, goal),
    timestamp,
    stages,
    currentStepIndex: resolved,
    isComplete: true,
    result,
    amountPaise: result.amount_paise ?? result.cart?.total_paise ?? 0,
    declined: false,
    error: null,
  };
}

/** A readable cart title from the real result, never a keyword guess. */
function titleForResult(result: OrchestratorResult, goal: string): string {
  const li = result.cart?.line_items?.[0]?.title;
  if (li) return li;
  if (result.state === "CHOOSE" && result.options?.length) {
    return `${result.options.length} options for "${goal}"`;
  }
  return goal.length > 48 ? `${goal.slice(0, 48)}…` : goal;
}

export const ShopPage: React.FC = () => {
  const { activeMandate, refreshMandates } = useMandate();
  const mandateId = activeMandate?.mandate_id || null;
  const [carts, setCarts] = useState<CartSession[]>([]);
  const [selectedCartId, setSelectedCartId] = useState<string | null>(null);
  // Which mandate the current `carts`/`selectedCartId` were hydrated for. The
  // save effects below only persist once this matches the bound mandate, so a
  // mandate switch never clobbers the new mandate's stored carts with the old
  // mandate's still-in-state values.
  const [hydratedMandate, setHydratedMandate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);

  const selectedCart = carts.find((c) => c.id === selectedCartId) || null;
  const sessionId = activeMandate?.session_id || null;

  // Rehydrate this mandate's run history whenever the bound mandate changes
  // (including the first async load and every tab remount). Two steps:
  //  1. Paint instantly from the localStorage cache (no network wait).
  //  2. Reconcile against the DB — the source of truth — merging by run_id so
  //     the durable server history wins on conflicts while any cache-only cards
  //     (e.g. an in-flight run, or history from before this feature) are kept.
  useEffect(() => {
    let cancelled = false;
    const cached = loadCarts(mandateId);
    setCarts(cached);
    const savedSel = loadSelectedCartId(mandateId);
    setSelectedCartId(savedSel && cached.some((c) => c.id === savedSel) ? savedSel : null);
    setHydratedMandate(mandateId);

    if (mandateId) {
      listRuns(mandateId)
        .then((runs) => {
          if (cancelled) return;
          const byId = new Map(cached.map((c) => [c.id, c]));
          for (const r of runs) byId.set(r.run_id, cartFromResult(r.run_id, r.goal, r.created_at, r.result));
          const merged = [...byId.values()].sort(
            (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
          );
          setCarts(merged);
        })
        .catch(() => {
          /* backend unreachable — keep the cached view, never wipe it */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [mandateId]);

  // Persist carts + selection — but only after hydration for THIS mandate.
  useEffect(() => {
    if (hydratedMandate !== mandateId) return;
    saveCarts(mandateId, carts);
  }, [carts, mandateId, hydratedMandate]);

  useEffect(() => {
    if (hydratedMandate !== mandateId) return;
    saveSelectedCartId(mandateId, selectedCartId);
  }, [selectedCartId, mandateId, hydratedMandate]);

  const patchCart = (id: string, patch: Partial<CartSession>) =>
    setCarts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Apply a REAL live stage event from the SSE stream to the pending cart's
  // stepper (this is genuine backend progress, not a timer).
  const applyStageEvent = (id: string, stageId: string, status: string) =>
    setCarts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const stages = c.stages.map((s) =>
          s.id === stageId ? { ...s, status: status as PipelineStageState["status"] } : s,
        );
        const activeIdx = stages.findIndex((s) => s.id === stageId);
        return { ...c, stages, currentStepIndex: activeIdx >= 0 ? activeIdx : c.currentStepIndex };
      }),
    );

  const applyResult = (id: string, goal: string, result: OrchestratorResult) => {
    const stages = stagesForState(result.state);
    // How far the real pipeline actually got — so the stepper never shows a
    // node as "done" that never ran (e.g. CHOOSE stops after searching).
    const resolved = stages.filter((s) => s.status !== "idle").length;
    patchCart(id, {
      title: titleForResult(result, goal),
      stages,
      currentStepIndex: resolved,
      isComplete: true,
      result,
      amountPaise: result.amount_paise ?? result.cart?.total_paise ?? 0,
      cartId: result.cart_id ?? "",
      declined: false,
      error: null,
    });
  };

  const handleSelectCart = (id: string) => setSelectedCartId(id);
  const handleNewCart = () => setSelectedCartId(null);
  const handleDeleteCart = (id: string) => {
    setCarts((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (selectedCartId === id) setSelectedCartId(remaining[0]?.id ?? null);
      return remaining;
    });
    // Also remove it from the durable server history (best-effort) so it doesn't
    // reappear on the next load. A cache-only card (never recorded) simply isn't
    // found server-side, which is fine.
    if (mandateId) deleteRun(mandateId, id).catch(() => {});
  };

  const handleSendGoal = async (goal: string) => {
    if (!activeMandate || !sessionId) return;
    setLoading(true);

    const internalId = `run_${crypto.randomUUID()}`;
    const pending: CartSession = {
      id: internalId,
      cartId: "",
      goal,
      title: "Running agent…",
      timestamp: new Date().toISOString(),
      stages: PENDING_STAGES,
      currentStepIndex: 0,
      isComplete: false,
      result: null,
      amountPaise: 0,
    };
    setCarts((prev) => [pending, ...prev]);
    setSelectedCartId(internalId);

    try {
      const result = await runAgentStream(
        sessionId,
        goal,
        (evt) => applyStageEvent(internalId, evt.id, evt.status),
        internalId,
      );
      applyResult(internalId, goal, result);
      await refreshMandates();
    } catch (err: any) {
      patchCart(internalId, {
        title: "Agent error",
        stages: PENDING_STAGES.map((s) => ({ ...s, status: "idle" as const })),
        isComplete: true,
        error: err?.message || "The agent request failed.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = async (itemId: string) => {
    if (!sessionId || !selectedCart) return;
    setLoading(true);
    const cartId = selectedCart.id;
    const goal = selectedCart.goal;
    patchCart(cartId, { stages: PENDING_STAGES, isComplete: false, title: "Composing selection…" });
    try {
      const result = await selectOptionStream(
        sessionId,
        itemId,
        (evt) => applyStageEvent(cartId, evt.id, evt.status),
        cartId,
        goal,
      );
      applyResult(cartId, goal, result);
      await refreshMandates();
    } catch (err: any) {
      patchCart(cartId, { isComplete: true, error: err?.message || "Selection failed." });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!sessionId || !selectedCart?.result?.cart_id) return;
    setApproving(true);
    const goal = selectedCart.goal;
    try {
      const result = await approveSession(
        sessionId,
        selectedCart.result.cart_id,
        selectedCart.id,
        goal,
      );
      applyResult(selectedCart.id, goal, result);
      await refreshMandates();
    } catch (err: any) {
      patchCart(selectedCart.id, { error: err?.message || "Approval failed." });
    } finally {
      setApproving(false);
    }
  };

  // Declining is a genuine local choice, not a backend verdict — we record it
  // as such and invent no refusal reason / hash / trace for it.
  const handleDecline = () => {
    if (!selectedCart) return;
    patchCart(selectedCart.id, { declined: true });
  };

  return (
    <div id="page-shop" className="flex flex-col min-h-[calc(100vh-12rem)] pb-32">
      {/* Active Mandate Context Strip */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 sm:p-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#111827] text-white flex items-center justify-center font-bold text-xs shadow-xs">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-[#111827]">
                Agent Shopping & Cart Console
              </h2>
              {activeMandate?.revoked ? (
                <Pill variant="slate">Revoked</Pill>
              ) : activeMandate ? (
                <Pill variant="green">Active</Pill>
              ) : null}
            </div>
            <p className="font-mono text-xs text-[#6B7280]">
              Bound Mandate: {activeMandate?.mandate_id || "No mandate selected"}
            </p>
          </div>
        </div>

        {activeMandate && (
          <div className="flex items-center gap-4">
            <div className="w-44 sm:w-52">
              <SpendMeter
                usedPaise={activeMandate.running_spend_paise || 0}
                totalPaise={activeMandate.budget_total_paise}
              />
            </div>
            <Link
              to="/mandate"
              className="font-mono text-xs text-[#2563EB] hover:underline whitespace-nowrap"
            >
              Configure →
            </Link>
          </div>
        )}
      </div>

      {!activeMandate && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl p-4 mb-6 text-sm text-[#92400E] font-mono">
          No active mandate. Create one in the{" "}
          <Link to="/mandate" className="underline font-semibold">Mandate Console</Link>{" "}
          to grant the agent bounded shopping authority.
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="w-full lg:w-[380px] xl:w-[410px] shrink-0 h-[640px] sticky top-20">
          <CartList
            carts={carts}
            selectedCartId={selectedCartId}
            onSelectCart={handleSelectCart}
            onNewCart={handleNewCart}
            onDeleteCart={handleDeleteCart}
          />
        </div>

        <div className="flex-1 w-full min-w-0">
          <CartDetailView
            cart={selectedCart}
            mandate={activeMandate}
            onApprove={handleApprove}
            onDecline={handleDecline}
            onSelectOption={handleSelectOption}
            approving={approving}
            onSelectScenario={handleSendGoal}
          />
        </div>
      </div>

      {/* Floating Goal Input */}
      <div className="fixed bottom-5 left-0 right-0 z-30 pointer-events-none px-4 flex justify-center">
        <GoalInput
          onSendGoal={handleSendGoal}
          loading={loading}
          disabled={!activeMandate || !!activeMandate.revoked}
        />
      </div>
    </div>
  );
};
