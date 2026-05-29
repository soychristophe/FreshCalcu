// ─── src/services/sessionService.ts ───────────────────────────────────────────
// Work-session tracking: records start/end of shift and productivity metrics.
// All data lives in localStorage — no network calls.
//
// Data model:
//   WorkSession  { id, startedAt, endedAt, scans, pullForwards,
//                  avgOperationMs, entries: SessionEntry[] }
//   SessionEntry { productId, productName, qty, pullQty, formulaUsed, timestamp }

import { STORAGE_KEY } from '@/config/constants.ts';
import type { WorkSession, SessionEntry } from '@/types/index.ts';

/* ── Module-private state ────────────────────────────────────────────────── */

let _current:      WorkSession | null = null;
let _opTimestamps: number[]           = [];   // timestamps of each op for avg calc

/* ── Persistence helpers ─────────────────────────────────────────────────── */

function loadAllSessions(): WorkSession[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY.SESSIONS) ?? '[]') as WorkSession[];
  } catch {
    return [];
  }
}

function persistAllSessions(sessions: WorkSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY.SESSIONS, JSON.stringify(sessions));
  } catch {
    /* quota exceeded — silently ignore */
  }
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/** Returns the active session, or null if no session is running. */
export function getCurrentSession(): WorkSession | null {
  return _current;
}

/** True if a session is currently running. */
export function isSessionActive(): boolean {
  return _current !== null;
}

/**
 * Starts a new work session.
 * If one is already active, returns it without creating a new one.
 */
export function startSession(): WorkSession {
  if (_current) return _current;

  _current = {
    id:             `session_${Date.now()}`,
    startedAt:      new Date().toISOString(),
    endedAt:        null,
    scans:          0,
    pullForwards:   0,
    avgOperationMs: 0,
    entries:        [],
  };
  _opTimestamps = [Date.now()];
  return _current;
}

/**
 * Records a SPED operation in the current session.
 * No-op if no session is active.
 */
export function addSessionEntry(entry: SessionEntry): void {
  if (!_current) return;

  _current.entries.push(entry);
  _current.scans++;
  if (entry.pullQty !== null && entry.pullQty > 0) _current.pullForwards++;

  // Running average of time between operations
  const now = Date.now();
  _opTimestamps.push(now);
  if (_opTimestamps.length >= 2) {
    let sum = 0;
    for (let i = 1; i < _opTimestamps.length; i++) {
      sum += (_opTimestamps[i] ?? 0) - (_opTimestamps[i - 1] ?? 0);
    }
    _current.avgOperationMs = Math.round(sum / (_opTimestamps.length - 1));
  }
}

/**
 * Ends the active session, persists it, and returns a copy.
 * Returns null if no session was active.
 */
export function endSession(): WorkSession | null {
  if (!_current) return null;

  _current.endedAt = new Date().toISOString();

  const finished  = { ..._current, entries: [..._current.entries] };
  const allSaved  = loadAllSessions();
  allSaved.push(finished);
  persistAllSessions(allSaved);

  _current      = null;
  _opTimestamps = [];

  return finished;
}

/** Returns all previously saved sessions from localStorage. */
export function getAllSessions(): WorkSession[] {
  return loadAllSessions();
}

/* ── Export helpers (no external dependencies) ───────────────────────────── */

/**
 * Triggers a browser download of a session as a JSON file.
 */
export function exportSessionAsJSON(session: WorkSession): void {
  const blob = new Blob([JSON.stringify(session, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, `freshways-session-${session.id}.json`);
}

/**
 * Triggers a browser download of a session as plain text.
 */
export function exportSessionAsText(session: WorkSession): void {
  const dur = session.endedAt
    ? _formatDuration(
        new Date(session.startedAt).getTime(),
        new Date(session.endedAt).getTime(),
      )
    : 'In progress';

  const lines: string[] = [
    '=== FRESHWAYS WORK SESSION ===',
    `ID:              ${session.id}`,
    `Start:           ${new Date(session.startedAt).toLocaleString()}`,
    `End:             ${session.endedAt ? new Date(session.endedAt).toLocaleString() : 'In progress'}`,
    `Duration:        ${dur}`,
    `Total scans:     ${session.scans}`,
    `Pull forwards:   ${session.pullForwards}`,
    `Avg op time:     ${session.avgOperationMs} ms`,
    '',
    '=== ENTRIES ===',
    ...session.entries.map(e => {
      const t    = new Date(e.timestamp).toLocaleTimeString();
      const pull = e.pullQty != null ? ` | Pull: ${e.pullQty}` : '';
      return `[${t}] ${e.productId} — ${e.productName} | Qty: ${e.qty}${pull} | Formula: ${e.formulaUsed}`;
    }),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  triggerDownload(blob, `freshways-session-${session.id}.txt`);
}

/**
 * Builds a human-readable summary string for the session end dialog.
 */
export function buildSessionSummary(session: WorkSession): string {
  const dur = session.endedAt
    ? _formatDuration(
        new Date(session.startedAt).getTime(),
        new Date(session.endedAt).getTime(),
      )
    : '—';

  return [
    `⏱  Duration: ${dur}`,
    `📦  Scans: ${session.scans}`,
    `⬅️  Pull Forwards: ${session.pullForwards}`,
    `⏱  Avg op time: ${session.avgOperationMs} ms`,
  ].join('\n');
}

/* ── Private utils ───────────────────────────────────────────────────────── */

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function _formatDuration(startMs: number, endMs: number): string {
  const totalSec = Math.round((endMs - startMs) / 1000);
  const h   = Math.floor(totalSec / 3600);
  const m   = Math.floor((totalSec % 3600) / 60);
  const s   = totalSec % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
