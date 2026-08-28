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

  it("attaches a timestamp before every run (e.g. session_created) to the EARLIEST run", () => {
    const beforeEverything = Date.parse("2026-08-28T07:22:46.000Z");
    expect(attributeTimestampToRun(beforeEverything, [RUN_A, RUN_B])).toBe("run_a");
    // Order of the input array must not matter.
    expect(attributeTimestampToRun(beforeEverything, [RUN_B, RUN_A])).toBe("run_a");
  });

  it("attaches a timestamp after every run's window to the LATEST run", () => {
    const afterEverything = Date.parse("2026-08-28T09:05:00.000Z");
    expect(attributeTimestampToRun(afterEverything, [RUN_A, RUN_B])).toBe("run_b");
  });

  it("returns null when there are no runs to attribute to at all", () => {
    expect(attributeTimestampToRun(Date.now(), [])).toBeNull();
  });
});
