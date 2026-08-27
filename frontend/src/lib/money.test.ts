import { describe, it, expect } from "vitest";
import { paiseToRupees, paiseToRupeesPlain, rupeesToPaise } from "./money";

describe("paiseToRupees", () => {
  it("formats paise as ₹ with two decimals", () => {
    expect(paiseToRupees(285000)).toBe("₹2,850.00");
    expect(paiseToRupees(508)).toBe("₹5.08");
    expect(paiseToRupees(0)).toBe("₹0.00");
  });

  it("uses Indian comma grouping", () => {
    // ₹15,66,900.00 — lakh grouping, not ₹1,566,900.00
    expect(paiseToRupees(156690000)).toBe("₹15,66,900.00");
  });

  it("rounds fractional paise and handles negatives", () => {
    expect(paiseToRupees(2849.6)).toBe("₹28.50");
    expect(paiseToRupees(-285000)).toBe("-₹2,850.00");
  });

  it("hides decimals only when whole and asked", () => {
    expect(paiseToRupees(285000, true)).toBe("₹2,850");
    expect(paiseToRupees(285050, true)).toBe("₹2,850.50");
  });

  it("degrades safely on NaN", () => {
    expect(paiseToRupees(NaN)).toBe("₹0.00");
  });
});

describe("paiseToRupeesPlain", () => {
  it("rounds to whole rupees, no decimals", () => {
    expect(paiseToRupeesPlain(600000)).toBe("₹6,000");
    expect(paiseToRupeesPlain(65089)).toBe("₹651"); // 650.89 -> 651
    expect(paiseToRupeesPlain(NaN)).toBe("₹0");
  });
});

describe("rupeesToPaise", () => {
  it("converts numbers and strings to integer paise", () => {
    expect(rupeesToPaise(2850)).toBe(285000);
    expect(rupeesToPaise("2850")).toBe(285000);
    expect(rupeesToPaise("5.08")).toBe(508);
  });

  it("strips ₹, commas, and whitespace", () => {
    expect(rupeesToPaise("₹ 2,850")).toBe(285000);
  });

  it("returns 0 on unparseable input (never NaN paise)", () => {
    expect(rupeesToPaise("abc")).toBe(0);
    expect(rupeesToPaise(NaN)).toBe(0);
  });

  it("is exact — no floating-point drift for a round-trip", () => {
    // The whole money contract: integer paise everywhere, no float errors.
    for (const rupees of [1, 19.99, 2850, 156699, 0.01]) {
      expect(rupeesToPaise(rupees)).toBe(Math.round(rupees * 100));
    }
  });
});
