import { describe, it, expect, beforeEach } from "vitest";
import type { CartSession } from "../components/shop/CartList";
import {
  loadCarts,
  saveCarts,
  loadSelectedCartId,
  saveSelectedCartId,
} from "./cartStore";

function cart(id: string, over: Partial<CartSession> = {}): CartSession {
  return {
    id,
    cartId: "crt_x",
    goal: "buy running shoes",
    title: "Trail Runner Shoe",
    timestamp: new Date().toISOString(),
    stages: [{ id: "outcome", label: "Outcome", status: "success" }],
    currentStepIndex: 5,
    isComplete: true,
    result: null,
    amountPaise: 150000,
    ...over,
  };
}

describe("cartStore", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips carts for a mandate", () => {
    const carts = [cart("run_1"), cart("run_2")];
    saveCarts("m-A", carts);
    const back = loadCarts("m-A");
    expect(back.map((c) => c.id)).toEqual(["run_1", "run_2"]);
    expect(back[0].amountPaise).toBe(150000);
  });

  it("keeps each mandate's history separate", () => {
    saveCarts("m-A", [cart("a1")]);
    saveCarts("m-B", [cart("b1"), cart("b2")]);
    expect(loadCarts("m-A").map((c) => c.id)).toEqual(["a1"]);
    expect(loadCarts("m-B").map((c) => c.id)).toEqual(["b1", "b2"]);
  });

  it("returns [] for an unknown or null mandate", () => {
    expect(loadCarts("never-saved")).toEqual([]);
    expect(loadCarts(null)).toEqual([]);
    expect(loadCarts(undefined)).toEqual([]);
  });

  it("heals an interrupted (mid-run) cart on load", () => {
    const midRun = cart("run_x", {
      isComplete: false,
      title: "Running agent…",
      stages: [{ id: "searching", label: "Searching", status: "active" }],
      error: null,
    });
    saveCarts("m-A", [midRun]);
    const [healed] = loadCarts("m-A");
    expect(healed.isComplete).toBe(true);
    expect(healed.title).toBe("Interrupted run");
    expect(healed.stages[0].status).toBe("idle");
    expect(healed.error).toMatch(/interrupted/i);
  });

  it("does not touch an already-complete cart", () => {
    const done = cart("run_ok", { title: "Trail Runner Shoe" });
    saveCarts("m-A", [done]);
    const [back] = loadCarts("m-A");
    expect(back.error).toBeUndefined();
    expect(back.title).toBe("Trail Runner Shoe");
  });

  it("survives corrupted storage without throwing", () => {
    localStorage.setItem("paybound.carts.m-A", "{not json");
    expect(loadCarts("m-A")).toEqual([]);
  });

  it("round-trips the selected cart id and clears it", () => {
    saveSelectedCartId("m-A", "run_2");
    expect(loadSelectedCartId("m-A")).toBe("run_2");
    saveSelectedCartId("m-A", null);
    expect(loadSelectedCartId("m-A")).toBeNull();
  });
});
