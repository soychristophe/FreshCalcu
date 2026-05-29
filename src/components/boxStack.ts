// ─── src/components/boxStack.ts ──────────────────────────────────────────────
// Box Stack component — renders a compact, dynamic stack visualization
// showing the progressive reduction of units across crates.
//
// Data source: state.boxVal (total qty) + safeEval(state.calcVal) (crate size).
// Called from calculator.ts → refresh() every time state changes.
//
// Layout per row:
//   .bstack-idx  — ordinal (0, 1, 2 …) in a small, muted style
//   .bstack-val  — remaining units, bold and accented

import { state }    from '@/state/appState.ts';
import { safeEval } from '@/utils/math.ts';

/* ── Module-level container reference ─────────────────────────────────────── */

let _container: HTMLElement | null = null;

/* ── Init ─────────────────────────────────────────────────────────────────── */

/**
 * Cache the container element once at startup.
 * Must be called after DOMContentLoaded.
 */
export function initBoxStack(): void {
  _container = document.getElementById('box-stack');
}

/* ── Render ───────────────────────────────────────────────────────────────── */

/**
 * Re-renders the stack based on current state.
 * Clears the container when qty or crateSize are invalid/zero.
 */
export function renderBoxStack(): void {
  if (!_container) return;

  const qty       = parseFloat(state.boxVal) || 0;
  const crateSize = safeEval(state.calcVal);

  // Nothing to display
  if (qty <= 0 || isNaN(crateSize) || crateSize <= 0) {
    _container.innerHTML = '';
    _container.hidden = true;
    return;
  }

  _container.hidden = false;

  // Build all rows as a document fragment for a single DOM flush
  const fragment = document.createDocumentFragment();

  let current = qty;
  let index   = 0;             // ← starts at 0

  while (current > 0) {
    const row = document.createElement('div');
    row.className = 'bstack-row';

    // Ordinal label — small, muted
    const idxEl = document.createElement('span');
    idxEl.className   = 'bstack-idx';
    idxEl.textContent = `${index}`;

    // Remaining-units value — bold, accented
    const valEl = document.createElement('span');
    valEl.className   = 'bstack-val';
    valEl.textContent = `${Math.round(current)}`;

    row.append(idxEl, valEl);
    fragment.appendChild(row);

    current -= crateSize;
    index++;
  }

  // Single reflow
  _container.replaceChildren(fragment);
}
