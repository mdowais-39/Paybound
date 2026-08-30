import { describe, it, expect } from "vitest";
import { attributeTimestampToRun } from "./auditGrouping";
import { AgentRun } from "./types";

function run(id: string, createdAt: string, updatedAt: string): AgentRun {
  return {
    run_id: id,
    session_id: "s1",
    goal: "buy running shoes",
    state: "AUTHORIZED",
    verdict: "approved",
    rule_cited: null,
    cart_id: "c1",
    total_paise: 100,
    message: null,
    payment_link: null,
    result: {} as any,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

// The exact scenario from the reported bug: two real, hours-apart purchase
// attempts sharing one session — must NOT merge into one card.
const RUN_A = run("run_a", "2026-08-28T07:23:02.979Z", "2026-08-28T07:23:28.484Z"); // APPROVED ₹2,879
const RUN_B = run("run_b", "2026-08-28T09:03:15.677Z", "2026-08-28T09:04:16.682Z"); // REFUSED ₹21,232

describe("attributeTimestampToRun", () => {
  it("attributes a timestamp inside a run's window to that run", () => {
    const ts = Date.parse("2026-08-28T07:23:15.000Z"); // inside RUN_A
    expect(attributeTimestampToRun(ts, [RUN_A, RUN_B])).toBe("run_a");
  });

  it("keeps two hours-apart runs in the same session separate", () => {
    const insideA = Date.parse("2026-08-28T07:23:27.000Z");
    const insideB = Date.parse("2026-08-28T09:04:00.000Z");
    expect(attributeTimestampToRun(insideA, [RUN_A, RUN_B])).toBe("run_a");
    expect(attributeTimestampToRun(insideB, [RUN_A, RUN_B])).toBe("run_b");
  });

  it("attaches a timestamp before every run (e.g. session_created) to the nearest (earliest) run", () => {
    const beforeEverything = Date.parse("2026-08-28T07:22:46.000Z");
    expect(attributeTimestampToRun(beforeEverything, [RUN_A, RUN_B])).toBe("run_a");
    // Order of the input array must not matter.
    expect(attributeTimestampToRun(beforeEverything, [RUN_B, RUN_A])).toBe("run_a");
  });

  it("attaches a timestamp after every run's window to the nearest (latest) run", () => {
    const afterEverything = Date.parse("2026-08-28T09:05:00.000Z");
    expect(attributeTimestampToRun(afterEverything, [RUN_A, RUN_B])).toBe("run_b");
  });

  it("returns null when there are no runs to attribute to at all", () => {
    expect(attributeTimestampToRun(Date.now(), [])).toBeNull();
  });

  // The actual production bug: a run's own late-stage audit entry (token_issued
  // / payment_effect), stamped by a clock that had drifted a few hundred ms
  // from the one that set `updated_at`, landed just PAST its own run's window.
  // The old rule ("no exact match → attach to the newest run in the whole
  // mandate") then dumped it onto a THIRD, unrelated, much-later run. Nearest-
  // by-distance must attach it back to the run it actually came from instead.
  it("attaches a near-miss just past an EARLIER run's window to that run, not the newest run overall", () => {
    const RUN_C = run("run_c", "2026-08-29T07:00:27.559Z", "2026-08-29T07:01:23.191Z"); // AUTHORIZED ₹3,656, hours after A and B
    // 307ms past RUN_B's own updated_at — exactly the drift observed in
    // production between the Rust host clock and Postgres's clock.
    const justPastRunB = Date.parse("2026-08-28T09:04:16.989Z");
    expect(attributeTimestampToRun(justPastRunB, [RUN_A, RUN_B, RUN_C])).toBe("run_b");
    // Order of the input array must not matter.
    expect(attributeTimestampToRun(justPastRunB, [RUN_C, RUN_A, RUN_B])).toBe("run_b");
  });

  it("still prefers a genuinely closer LATER run over a further-away earlier one", () => {
    const RUN_C = run("run_c", "2026-08-29T07:00:27.559Z", "2026-08-29T07:01:23.191Z");
    // Almost 22 hours after RUN_B ends, but ~3.5s before RUN_C starts — nearer to C.
    const closerToC = Date.parse("2026-08-29T07:00:24.000Z");
    expect(attributeTimestampToRun(closerToC, [RUN_A, RUN_B, RUN_C])).toBe("run_c");
  });
});
