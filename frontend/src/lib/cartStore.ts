// Persistent run-history for the shopping console. Each cart is a genuine
// record of a real agent run against a mandate — so keeping them across tab
// switches and page reloads is honest, not fabricated. We store them in
// localStorage keyed by mandate, so every mandate carries its own cart list
// and switching mandates shows that mandate's runs (never a mixed history).
//
// Storage is a per-viewer convenience: it can be empty (private window, cleared
// data, first visit) or throw (storage disabled), and every access is guarded.

import { CartSession } from "../components/shop/CartList";
import { PipelineStageState } from "./types";

const PREFIX = "paybound.carts.";
const SELECTED_PREFIX = "paybound.selectedCart.";

function key(mandateId: string): string {
  return `${PREFIX}${mandateId}`;
}

function selectedKey(mandateId: string): string {
  return `${SELECTED_PREFIX}${mandateId}`;
}

/** A run that was mid-flight when the page unloaded can't be resumed — its SSE
 * stream is gone. On rehydration we finalize any still-"evaluating" cart as an
 * honest interrupted state rather than leaving a spinner that never resolves. */
function healInterrupted(cart: CartSession): CartSession {
  if (cart.isComplete) return cart;
  return {
    ...cart,
    isComplete: true,
    title: cart.title === "Running agent…" ? "Interrupted run" : cart.title,
    stages: cart.stages.map((s) =>
      s.status === "active"
        ? ({ ...s, status: "idle" } as PipelineStageState)
        : s,
    ),
    error:
      cart.error ||
      "This run was interrupted (the page reloaded before it finished). Start a new cart to try again.",
  };
}

/** Load the persisted carts for a mandate, healing any interrupted runs. */
export function loadCarts(mandateId: string | null | undefined): CartSession[] {
  if (!mandateId) return [];
  try {
    const raw = localStorage.getItem(key(mandateId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(healInterrupted);
  } catch {
    return [];
  }
}

/** Persist the carts for a mandate. No-op when storage is unavailable. */
export function saveCarts(mandateId: string | null | undefined, carts: CartSession[]): void {
  if (!mandateId) return;
  try {
    localStorage.setItem(key(mandateId), JSON.stringify(carts));
  } catch {
    /* storage disabled / quota — the in-memory state still holds this session */
  }
}

/** Load the last-selected cart id for a mandate (may be null). */
export function loadSelectedCartId(mandateId: string | null | undefined): string | null {
  if (!mandateId) return null;
  try {
    return localStorage.getItem(selectedKey(mandateId));
  } catch {
    return null;
  }
}

/** Persist which cart is selected for a mandate. */
export function saveSelectedCartId(
  mandateId: string | null | undefined,
  cartId: string | null,
): void {
  if (!mandateId) return;
  try {
    if (cartId) localStorage.setItem(selectedKey(mandateId), cartId);
    else localStorage.removeItem(selectedKey(mandateId));
  } catch {
    /* ignore */
  }
}
