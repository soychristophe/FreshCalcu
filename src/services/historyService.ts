// ─── src/services/historyService.ts ───────────────────────────────────────────
// Manages the SPED scan history.
//
// Two storage layers:
//   localStorage  → immediate, offline-safe, always up-to-date locally
//   D1 (Worker)   → authoritative remote store, synced asynchronously
//
// Public surface is deliberately small — components consume the exported
// reactive list via the returned array (re-read after each mutation).

import { STORAGE_KEY } from '@/config/constants.ts';
import {
  apiAddHistory,
  apiAddHistoryAll,
  apiGetHistory,
  apiClearHistory,
} from '@/services/api.ts';
import type { HistoryEntry, Product } from '@/types/index.ts';

/* ── Internal state ──────────────────────────────────────────────────────── */

let _history: HistoryEntry[] = loadFromStorage();

function loadFromStorage(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.HISTORY) ?? '[]') as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveToStorage(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY.HISTORY, JSON.stringify(entries));
  } catch {
    /* ignore quota errors */
  }
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/** Returns the current history snapshot (read-only). */
export function getHistory(): readonly HistoryEntry[] {
  return _history;
}

/**
 * Adds or updates a product in the history.
 * Local write is immediate; D1 write is fire-and-forget.
 */
export function addToHistory(product: Product): void {
  const now     = new Date();
  const timeStr = now.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const idStr = String(product.id);
  const idx   = _history.findIndex(h => h.id === idStr);

  if (idx >= 0) {
    // Update existing entry in-place (immutable replacement)
    _history = [
      ..._history.slice(0, idx),
      { ..._history[idx], time: timeStr, name: product.name ?? '' },
      ..._history.slice(idx + 1),
    ];
  } else {
    _history = [{ id: idStr, name: product.name ?? '', time: timeStr }, ..._history];
  }

  saveToStorage(_history);

  // Fire-and-forget remote writes (non-blocking)
  if (navigator.onLine) {
    apiAddHistory(idStr, product.name ?? '').catch(() => undefined);
    apiAddHistoryAll(idStr, product.name ?? '', null, null).catch(() => undefined);
  }
}

/**
 * Clears all history locally and on D1.
 * UI update is the caller's responsibility (re-read getHistory()).
 */
export function clearHistory(): void {
  _history = [];
  saveToStorage(_history);

  if (navigator.onLine) {
    apiClearHistory().catch(() => undefined);
  }
}

/**
 * Syncs from D1 on app startup.
 * Remote is the source of truth; local is overwritten if remote responds.
 * Returns the updated list so callers can re-render immediately.
 */
export async function syncHistoryFromDB(): Promise<readonly HistoryEntry[]> {
  if (!navigator.onLine) return _history;
  try {
    const remote = await apiGetHistory();
    if (!remote) return _history;

    _history = remote.map(r => {
      let t = r.time ?? '';
      try {
        const d = new Date(r.time);
        if (!isNaN(d.getTime())) {
          t = d.toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
        }
      } catch {
        /* keep t as-is */
      }
      return { rowId: r.rowId, id: r.id, name: r.name, time: t };
    });

    saveToStorage(_history);
    return _history;
  } catch {
    return _history; // stay with local
  }
}
