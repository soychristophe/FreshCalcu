// ─── src/config/constants.ts ──────────────────────────────────────────────────
// Single source of truth for every magic string, number, and key.
// Vite injects VITE_* env vars at build time — never at runtime.
import type { TabConfig, TabMode } from '@/types/index.ts';

/* ── API ────────────────────────────────────────────────────────────────── */

/**
 * Cloudflare Worker base URL.
 * Override via VITE_API_BASE in .env.local for local dev proxying.
 */
export const API_BASE: string =
  import.meta.env['VITE_API_BASE'] ?? 'https://freshways-api.soychristophe.workers.dev';

/** Delete-product PIN. Stored in env, not in source code. */
export const DELETE_PIN: string = import.meta.env['VITE_DELETE_PIN'] ?? '1986';

/* ── Timeouts (ms) ──────────────────────────────────────────────────────── */
export const TIMEOUT = {
  SEARCH:       4_000,
  HISTORY:      5_000,
  HISTORY_ALL:  8_000,
  PRODUCT_ALL: 10_000,
} as const;

/* ── localStorage keys ──────────────────────────────────────────────────── */
export const STORAGE_KEY = {
  CALC:             'fw_calc_v9',
  HISTORY:          'fw_sped_history',
  PRODUCTS:         'fw_products_v1',
  /** ISO timestamp of the last successful product cache refresh. */
  PRODUCT_CACHE_TS: 'fw_products_cache_ts',
  /** Array of WorkSession objects. */
  SESSIONS:         'fw_work_sessions',
  /** Number: total products to process in current shift (for progress counter). */
  SPED_TOTAL:       'fw_sped_total',
} as const;

/* ── Calculator ─────────────────────────────────────────────────────────── */
export const OPS = new Set(['+', '-', '*', '/']);

/* ── Tab routing ────────────────────────────────────────────────────────── */
export const TAB_CONFIG: Readonly<Record<TabMode, TabConfig>> = {
  calc: { sectionKey: 'secMain', display: 'flex'  },
  box:  { sectionKey: 'secMain', display: 'flex'  },
  msj:  { sectionKey: 'secMsj',  display: 'block' },
  sped: { sectionKey: 'secSped', display: 'flex'  },
} as const;

/** Maps physical function keys to tab names. */
export const FKEY_TABS: Readonly<Record<string, TabMode>> = {
  F10: 'sped',
  F11: 'calc',
  F12: 'msj',
} as const;

/** Maps F-keys to operator strings. */
export const FKEY_OPS: Readonly<Record<string, string>> = {
  F1: '+',
  F2: '-',
  F3: '*',
  F4: '/',
} as const;

/* ── Search debounce (ms) ─────────────────────────────────────────────── */
export const SEARCH_DEBOUNCE_MS = 280;

/* ── Haptic ─────────────────────────────────────────────────────────────── */
export const HAPTIC_DURATION_MS = 15;
