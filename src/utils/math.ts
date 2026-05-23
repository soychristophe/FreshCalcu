// ─── src/utils/math.ts ────────────────────────────────────────────────────────
// Pure mathematical utilities — no DOM, no state, fully testable.

export const round1 = (n: number): number => Math.round(n * 10)  / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Safely evaluates a simple arithmetic expression.
 *
 * SECURITY: A regex guard allows only digits, operators (+−×÷),
 * parentheses, dots and spaces before the expression reaches
 * the Function constructor. This is an intentional, controlled use —
 * the eslint no-new-func rule is disabled only for this one function.
 *
 * @returns The numeric result, or NaN if the expression is invalid.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
export function safeEval(expr: string | number): number {
  const s = String(expr);
  if (!/^[\d+\-*/.() ]+$/.test(s)) return NaN;
  try {
    // eslint-disable-next-line no-new-func
    const result: unknown = new Function(`"use strict"; return (${s})`)();
    return typeof result === 'number' && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

/* ── Formula selection ───────────────────────────────────────────────────── */

/**
 * Picks the formula from `values` that minimises the number of full boxes
 * needed to hold `qty` units.  Tie-breaks on smallest divisor.
 *
 * @returns The best formula string, or `null` if none is valid.
 */
export function pickBestFormula(values: readonly string[], qty: number): string | null {
  let bestFormula    = '';
  let bestTotalBoxes = Infinity;
  let bestDivisor    = Infinity;

  for (const val of values) {
    const divisor = safeEval(val);
    if (isNaN(divisor) || divisor <= 0) continue;

    const totalBoxes = Math.ceil(qty / divisor);
    if (
      totalBoxes < bestTotalBoxes ||
      (totalBoxes === bestTotalBoxes && divisor < bestDivisor)
    ) {
      bestFormula    = val;
      bestTotalBoxes = totalBoxes;
      bestDivisor    = divisor;
    }
  }

  return bestFormula || null;
}

/* ── Crate calculation ───────────────────────────────────────────────────── */

export interface CrateCalcResult {
  divisor: number;
  full:    number;
  rem:     number;
}

/**
 * Computes full crates and remainder units for a given formula and quantity.
 * @returns `null` if the formula evaluates to a non-positive number.
 */
export function computeCrateCalc(formula: string, qty: number): CrateCalcResult | null {
  const divisor = safeEval(formula);
  if (isNaN(divisor) || divisor <= 0) return null;
  return {
    divisor,
    full: Math.floor(qty / divisor),
    rem:  round2(qty % divisor),
  };
}

/* ── Remainder sub-formula ───────────────────────────────────────────────── */

/**
 * Given a multiplication formula like "9*6" and a remainder,
 * returns a human-readable breakdown of how many sub-units the remainder fills.
 *
 * e.g. formula="9*6", rem=11 → "(9 x 1) + 2"
 */
export function getRemainderFormula(formula: string, remainder: number): string {
  if (formula.includes('*')) {
    const firstFactor = parseFloat(formula.split('*')[0] ?? '');
    if (!isNaN(firstFactor) && firstFactor > 0 && remainder > 0) {
      const extraBoxes = Math.floor(remainder / firstFactor);
      const remaining  = round2(remainder % firstFactor);
      if (extraBoxes > 0 && remaining > 0) return `(${firstFactor} x ${extraBoxes}) + ${remaining}`;
      if (extraBoxes > 0)                  return `(${firstFactor} x ${extraBoxes})`;
      return `${remaining}`;
    }
  }
  return remainder > 0 ? `Remainder: ${remainder}` : '';
}
