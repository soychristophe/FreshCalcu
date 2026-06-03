// ─── src/services/historyService.ts ───────────────────────────────────────────
// Manages the SPED scan history.
//
// Two storage layers:
//   localStorage  → día actual únicamente. Se purga automáticamente al detectar
//                   un cambio de fecha (nueva sesión de trabajo).
//   D1 (Worker)   → histórico completo, NUNCA se modifica por la purga automática.
//                   Solo se borra si el usuario pulsa "Clear history" de forma
//                   explícita (clearHistory → apiClearHistory).
//
// Public surface is deliberately small — components consume the exported
// reactive list via the returned array (re-read after each mutation).

import { STORAGE_KEY } from '@/config/constants.ts';
import {
  apiAddHistory,
  apiAddHistoryAll,
  apiGetHistory,
  apiClearHistory,
  apiDeleteHistoryEntry,
} from '@/services/api.ts';
import type { HistoryEntry, Product } from '@/types/index.ts';

/* ── Date-purge helpers (localStorage ONLY) ──────────────────────────────── */

/**
 * Clave auxiliar que guarda la fecha de la última sesión (YYYY-MM-DD).
 * Solo se usa en localStorage; D1 no conoce esta clave.
 */
const HISTORY_DATE_LS_KEY = 'fw_sped_history_date';

/** Devuelve la fecha de hoy como YYYY-MM-DD en la zona horaria local. */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Comprueba si el día ha cambiado respecto a la última vez que se cargó la app.
 * Siempre actualiza HISTORY_DATE_LS_KEY con la fecha de hoy antes de retornar.
 *
 * Solo toca localStorage — no realiza ninguna llamada a la API ni a D1.
 */
function isNewDay(): boolean {
  try {
    const today    = todayStr();
    const lastDate = localStorage.getItem(HISTORY_DATE_LS_KEY);
    localStorage.setItem(HISTORY_DATE_LS_KEY, today);
    return lastDate !== null && lastDate !== today;
  } catch {
    return false;
  }
}

/* ── Internal state ──────────────────────────────────────────────────────── */

let _history: HistoryEntry[] = loadFromStorage();

/**
 * Lee el historial de localStorage.
 * Si detecta un cambio de día, borra ÚNICAMENTE los datos locales y
 * devuelve un array vacío. D1 no se toca en ningún caso.
 */
function loadFromStorage(): HistoryEntry[] {
  try {
    if (isNewDay()) {
      // Nuevo día de trabajo → limpia solo el localStorage.
      // ⚠️ D1 NO se modifica: apiClearHistory() NO se llama aquí.
      localStorage.removeItem(STORAGE_KEY.HISTORY);
      try { localStorage.removeItem('fw_sped_total'); } catch { /* ignore */ }
      return [];
    }
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
    // Update existing entry in-place — preserve qty values if already set.
    const existing = _history[idx];
    if (existing) {
      const updated: HistoryEntry = {
        id:   existing.id,
        name: product.name ?? '',
        time: timeStr,
        ...(existing.rowId   !== undefined ? { rowId:   existing.rowId }   : {}),
        ...(existing.qty     !== undefined ? { qty:     existing.qty }     : {}),
        ...(existing.pullQty !== undefined ? { pullQty: existing.pullQty } : {}),
      };
      _history = [
        ..._history.slice(0, idx),
        updated,
        ..._history.slice(idx + 1),
      ];
    }
  } else {
    _history = [{ id: idStr, name: product.name ?? '', time: timeStr }, ..._history];
  }

  saveToStorage(_history);

  // Fire-and-forget remote write (non-blocking).
  // apiAddHistory → scan_history (History Day, current-day panel).
  // apiAddHistoryAll → scan_history_all (History All cloud log).
  //   • Called here with qty=null so EVERY scan appears in History All,
  //     even when the user never proceeds to enter a quantity.
  //   • renderCalcResult / renderPullResult will call apiAddHistoryAll again
  //     with the real qty values once the calculation is done. The Worker
  //     should upsert by (barcode_id, date) or insert a new row — either
  //     way the final row with qty is always present.
  if (navigator.onLine) {
    apiAddHistory(idStr, product.name ?? '').catch(() => undefined);
    apiAddHistoryAll(idStr, product.name ?? '', null, null).catch(() => undefined);
  }
}

/**
 * Updates an existing history entry with the CC Qty and Pull Qty values
 * produced by processSped(). Called after a successful calculation.
 */
export function updateHistoryWithQty(
  id:      string,
  qty:     number,
  pullQty: number | null,
): void {
  const idStr = String(id);
  const idx   = _history.findIndex(h => h.id === idStr);
  if (idx < 0) return;

  const existing = _history[idx];
  if (!existing) return;

  const updated: HistoryEntry = {
    ...existing,
    qty,
    pullQty: pullQty ?? null,
  };

  _history = [
    ..._history.slice(0, idx),
    updated,
    ..._history.slice(idx + 1),
  ];

  saveToStorage(_history);

  // Sync qty values to D1 history table (fire-and-forget)
  if (navigator.onLine) {
    apiAddHistory(idStr, updated.name, qty, pullQty).catch(() => undefined);
  }
}

/**
 * Removes a single entry from history locally and from D1 (by rowId).
 * If the entry has no rowId (offline-only), only the local array is updated.
 */
export function removeFromHistory(id: string): void {
  const entry = _history.find(h => h.id === id);
  _history = _history.filter(h => h.id !== id);
  saveToStorage(_history);

  if (navigator.onLine && entry?.rowId !== undefined) {
    apiDeleteHistoryEntry(entry.rowId).catch(() => undefined);
  }
}

/**
 * Clears all history locally and on D1.
 * This is the ONLY function that modifies D1 — and only when the user
 * triggers it explicitly. The automatic date-purge never reaches here.
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
 * Remote is the source of truth for the current day; local is overwritten.
 * Returns the updated list so callers can re-render immediately.
 *
 * D1 contains the full historical audit log and is NEVER modified here.
 * Only entries whose D1 timestamp belongs to today are kept in localStorage
 * so the local UI stays scoped to the current working day.
 */
export async function syncHistoryFromDB(): Promise<readonly HistoryEntry[]> {
  if (!navigator.onLine) return _history;
  try {
    const remote = await apiGetHistory();
    if (!remote) return _history;

    const today = todayStr(); // YYYY-MM-DD

    // Capture the pre-sync local snapshot so we can recover qty / pullQty
    // values that were calculated this session and persisted to localStorage.
    // The remote payload only carries {rowId, id, name, time} — those numeric
    // fields never travel over the wire and would be lost without this merge.
    const localSnapshot = new Map(_history.map(h => [h.id, h]));

    // ── Traer de D1 → filtrar localmente al día de hoy ───────────────────
    // D1 se consulta completo (apiGetHistory no recibe filtros de fecha).
    // Solo guardamos en localStorage los registros de hoy.
    // El histórico de D1 permanece intacto; aquí no se llama a ninguna
    // API de escritura o borrado.
    _history = remote
      .filter(r => {
        // D1 almacena time como ISO-8601. Descartamos cualquier registro
        // que no sea de hoy para mantener el localStorage day-scoped.
        try {
          const d = new Date(r.time);
          if (isNaN(d.getTime())) return false;
          const rDate =
            `${d.getFullYear()}-` +
            `${String(d.getMonth() + 1).padStart(2, '0')}-` +
            `${String(d.getDate()).padStart(2, '0')}`;
          return rDate === today;
        } catch {
          return false;
        }
      })
      .map(r => {
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

        const local = localSnapshot.get(r.id);
        // Prefer local qty (may have been set this session after sync);
        // fall back to the value stored in D1 (r.qty / r.pull_qty).
        const mergedQty     = local?.qty     !== undefined ? local.qty     : (r.qty     ?? undefined);
        const mergedPullQty = local?.pullQty !== undefined ? local.pullQty : (r.pull_qty ?? undefined);
        const entry: HistoryEntry = {
          rowId: r.rowId,
          id:    r.id,
          name:  r.name,
          time:  t,
          ...(mergedQty     !== undefined ? { qty:     mergedQty }     : {}),
          ...(mergedPullQty !== undefined ? { pullQty: mergedPullQty } : {}),
        };
        return entry;
      });

    saveToStorage(_history);
    return _history;
  } catch {
    return _history; // stay with local
  }
}
