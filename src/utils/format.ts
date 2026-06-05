// ─── src/utils/format.ts ──────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp into the compact format used in history-all:
 *   "(25-05-20)-14:30:05"
 */
export function formatHistoryAllDate(isoStr: string): string {
  try {
    const d  = new Date(isoStr);
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `(${yy}/${mm}/${dd})-${hh}:${mi}:${ss}`;
  } catch {
    return isoStr ?? '';
  }
}

/**
 * Transforms the raw Values input field string before persisting.
 *
 * Rules applied in order:
 *   1. Remove whitespace around math operators so "9 x 6" → "9x6"
 *   2. x / X / × / M  →  *    (multiplication)
 *   3. m / s / S       →  +    (addition — m is Spanish shortcut for más/plus)
 *   4. .               →  ", " (formula separator: dot)
 *   5. remaining spaces →  ", " (formula separator: space)
 *
 * Examples:
 *   "7m3"         → "7+3"
 *   "7x3m5"       → "7*3+5"
 *   "9x6.9x7"     → "9*6, 9*7"
 *   "red blue"    → "red, blue"
 */
export function transformValuesInput(raw: string): string {
  // 1. Collapse spaces around operators
  const cleaned = raw.replace(/\s*([xXmM×*sS+\-/])\s*/g, '$1');
  // 2–5. Apply replacements
  return cleaned
    .replace(/[xX×]/g, '*')   // multiplication aliases → *
    .replace(/[mMsS]/g,  '+')   // addition aliases → + (m = más/plus)
    .replace(/\./g,      ', ')  // dot → formula separator
    .replace(/ /g,       ', '); // remaining space → formula separator
}
