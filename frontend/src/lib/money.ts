/**
 * Money utilities for Paybound.
 * Rule: Money is always integer paise everywhere in code and API payloads.
 * ₹1 = 100 paise.
 */

export function paiseToRupees(paise: number, hideDecimals = false): string {
  if (isNaN(paise) || paise === null || paise === undefined) {
    return "₹0.00";
  }

  const isNegative = paise < 0;
  const absPaise = Math.abs(Math.round(paise));
  const rupees = Math.floor(absPaise / 100);
  const remainingPaise = absPaise % 100;

  // Format rupees with Indian comma grouping (en-IN)
  const formattedRupees = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(rupees);

  if (hideDecimals && remainingPaise === 0) {
    return `${isNegative ? "-" : ""}₹${formattedRupees}`;
  }

  const formattedPaise = remainingPaise.toString().padStart(2, "0");
  return `${isNegative ? "-" : ""}₹${formattedRupees}.${formattedPaise}`;
}

export function paiseToRupeesPlain(paise: number): string {
  if (isNaN(paise) || paise === null || paise === undefined) {
    return "₹0";
  }
  const rupees = Math.round(paise / 100);
  return `₹${new Intl.NumberFormat("en-IN").format(rupees)}`;
}

export function rupeesToPaise(rupeesInput: number | string): number {
  if (typeof rupeesInput === "string") {
    // Strip ₹ symbol, commas, and whitespace
    const clean = rupeesInput.replace(/[₹,\s]/g, "");
    const parsed = parseFloat(clean);
    if (isNaN(parsed)) return 0;
    return Math.round(parsed * 100);
  }
  if (typeof rupeesInput === "number") {
    if (isNaN(rupeesInput)) return 0;
    return Math.round(rupeesInput * 100);
  }
  return 0;
}
