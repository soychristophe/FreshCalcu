// ─── src/state/appState.ts ────────────────────────────────────────────────────
// Single mutable application state object.
// Every mutation goes through a setter so we have one place to add
// logging, persistence, or reactivity in the future.

import { STORAGE_KEY } from '@/config/constants.ts';
import type { AppState } from '@/types/index.ts';

/* ── Initial state ───────────────────────────────────────────────────────── */

function readCalcVal(): string {
  try {
    return localStorage.getItem(STORAGE_KEY.CALC) ?? '0';
  } catch {
    return '0';
  }
}

export const state: AppState = {
  mode:             'calc',
  inputFocus:       'calc',
  calcVal:          readCalcVal(),
  boxVal:           '0',
  selectedProduct:  null,
  msjAngle:         90,
  deferredPrompt:   null,
  spedOriginalCalc: null,
  spedPullCalc:     null,
  spedCurrentView:  'step1',
};

/* ── Persistence ─────────────────────────────────────────────────────────── */

export function persistCalc(): void {
  try {
    localStorage.setItem(STORAGE_KEY.CALC, state.calcVal);
  } catch {
    /* ignore */
  }
}
