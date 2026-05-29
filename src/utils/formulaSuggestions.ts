// ─── src/utils/formulaSuggestions.ts ──────────────────────────────────────────
// Formula-suggestion engine for the Calculator tab.
//
// COMPARISON METRIC — mirrors pickBestFormula() in math.ts exactly:
//   Primary:   Math.ceil(qty / divisor)  → fewer total boxes = better
//   Tiebreak:  divisor ASC               → smaller divisor = last box fuller = better
//
// Rules:
//  • Only formulas that START WITH THE SAME PREFIX are considered.
//    "9*8" → only "9*N" variants; "10*5" → only "10*N" variants.
//  • Formulas are sourced from the global product cache (all products).
//  • The "current" formula is always included in the result for reference.
//  • Max 4 results total (including current).
//  • Sort: fewer-boxes → better-fill → current → worse-fill → more-boxes.

import { getAllCachedFormulas } from '@/services/productCache.ts';
import { safeEval, computeCrateCalc } from '@/utils/math.ts';

/* ── Public types ─────────────────────────────────────────────────────────── */

/**
 * Quality classification — aligned with pickBestFormula's metric:
 *   fewer-boxes  → Math.ceil(qty/divisor) is strictly lower  (best)
 *   better-fill  → same ceil total, divisor is smaller       (last box more full)
 *   current      → the formula currently entered             (reference)
 *   worse-fill   → same ceil total, divisor is larger        (last box less full)
 *   more-boxes   → Math.ceil(qty/divisor) is strictly higher (worst)
 */
export type SuggestionQuality =
  | 'fewer-boxes'   // 🟢 fewer total crates needed
  | 'better-fill'   // 🔵 same total crates, last box is fuller
  | 'current'       // ⬤  formula currently in the calculator
  | 'worse-fill'    // 🟡 same total crates, last box is less full
  | 'more-boxes';   // 🔴 more total crates needed

export interface FormulaSuggestion {
  readonly formula:    string;
  readonly divisor:    number;
  readonly totalBoxes: number;   // Math.ceil(qty / divisor)
  readonly full:       number;   // Math.floor(qty / divisor)
  readonly rem:        number;   // qty % divisor
  readonly quality:    SuggestionQuality;
  /** totalBoxes - currentTotalBoxes  (negative = fewer = better) */
  readonly deltaBoxes: number;
}

/* ── Sort order ──────────────────────────────────────────────────────────── */

const QUALITY_ORDER: Record<SuggestionQuality, number> = {
  'fewer-boxes':  0,
  'better-fill':  1,
  'current':      2,
  'worse-fill':   3,
  'more-boxes':   4,
};

/* ── Core function ───────────────────────────────────────────────────────── */

/**
 * Returns formula suggestions for the Calculator tab.
 *
 * @param currentFormula  Formula currently in the CALCULATOR display (e.g. "9*8").
 * @param qty             Numeric value in UNIT PRODUCT (boxVal).
 * @returns               Sorted array (max 4, current included), or null when
 *                        not applicable.
 */
export function getFormulaSuggestions(
  currentFormula: string,
  qty: number,
): FormulaSuggestion[] | null {

  if (qty <= 0) return null;

  // Only works for multiplication formulas
  const starIdx = currentFormula.indexOf('*');
  if (starIdx === -1) return null;

  // Prefix: "9*8" → "9*"  |  "10*5" → "10*"  |  "12*" → "12*"
  const prefix = currentFormula.slice(0, starIdx + 1);

  // Current formula must be a valid complete expression
  const currentDivisor = safeEval(currentFormula);
  if (isNaN(currentDivisor) || currentDivisor <= 0) return null;

  const currentCalc       = computeCrateCalc(currentFormula, qty)!;
  const currentTotalBoxes = Math.ceil(qty / currentDivisor);

  // Collect all unique formulas from the product cache
  const allFormulas = getAllCachedFormulas();

  // Filter: same prefix, not the current formula, valid divisor
  const variants = allFormulas.filter(f => {
    if (f === currentFormula) return false;
    if (!f.startsWith(prefix)) return false;
    const d = safeEval(f);
    return !isNaN(d) && d > 0;
  });

  if (variants.length === 0) return null;

  // Build suggestion list — always include current as reference
  const suggestions: FormulaSuggestion[] = [
    {
      formula:    currentFormula,
      divisor:    currentCalc.divisor,
      totalBoxes: currentTotalBoxes,
      full:       currentCalc.full,
      rem:        currentCalc.rem,
      quality:    'current',
      deltaBoxes: 0,
    },
  ];

  for (const formula of variants) {
    const divisor = safeEval(formula);
    const calc    = computeCrateCalc(formula, qty);
    if (!calc) continue;

    const totalBoxes = Math.ceil(qty / divisor);
    const deltaBoxes = totalBoxes - currentTotalBoxes;

    // Mirror pickBestFormula: fewer ceil wins; same ceil → smaller divisor wins
    let quality: SuggestionQuality;
    if      (deltaBoxes < 0)                                   quality = 'fewer-boxes';
    else if (deltaBoxes === 0 && divisor < currentDivisor)     quality = 'better-fill';
    else if (deltaBoxes === 0 && divisor > currentDivisor)     quality = 'worse-fill';
    else                                                       quality = 'more-boxes';

    suggestions.push({ formula, divisor, totalBoxes, full: calc.full, rem: calc.rem, quality, deltaBoxes });
  }

  // Sort: quality order first; within same quality mirror pickBestFormula
  // (fewer totalBoxes → smaller divisor)
  suggestions.sort((a, b) => {
    const qDiff = QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality];
    if (qDiff !== 0) return qDiff;
    if (a.totalBoxes !== b.totalBoxes) return a.totalBoxes - b.totalBoxes;
    return a.divisor - b.divisor;
  });

  // Max 4 total (including current)
  return suggestions.slice(0, 4);
}
