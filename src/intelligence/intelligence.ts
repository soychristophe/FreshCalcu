// ─── src/components/intelligence/intelligence.ts ──────────────────────────────
// Predictive product intelligence panel.
//
// Scoring model (per product, last 30 days of history-all, excluding today):
//   score = timeScore + baseScore
//
//   timeScore  (70% dominance via Gaussian bell curve)
//     avgHour  = mean decimal hour of historical scans  (08:15 → 8.25)
//     hourDiff = |currentHour - avgHour|
//     timeScore = exp( -hourDiff² / 2 )           → 1.0 at exact hour,
//                                                     ~0.60 at ±1 h,
//                                                     ~0.08 at ±3 h
//
//   baseScore  (frequency + recency, 30% weight)
//     freq30   = occurrences in last 30 days / 30   (normalised 0‥1)
//     recency  = Σ exp(-dayAge) for each scan       (exponential decay)
//     baseScore = freq30 * 0.20 + recency * 0.10
//
// Top 5 candidates are shown, excluding barcodes already scanned today.
// ─────────────────────────────────────────────────────────────────────────────

import { apiGetHistoryAll }  from '@/services/api.ts';
import { getHistory }        from '@/services/historyService.ts';
import { haptic, findEl }    from '@/utils/dom.ts';
import type { HistoryAllEntry } from '@/types/index.ts';

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface Candidate {
  readonly barcode:      string;
  readonly name:         string;
  /** Mean decimal hour across all historical scans (e.g. 8.25 = 08:15). */
  readonly avgHour:      number;
  /** Gaussian time-proximity score [0, 1]. */
  readonly timeScore:    number;
  /** Combined final score (timeScore + baseScore). */
  readonly score:        number;
  /** Number of occurrences in the last 30 days. */
  readonly freq:         number;
}

/* ── Internal state ──────────────────────────────────────────────────────── */

let _panelOpen = false;
let _loading   = false;

/* ── Public API ──────────────────────────────────────────────────────────── */

export function initIntelligence(): void {
  _injectHTML();
  _bindEvents();
}

export async function toggleIntelligencePanel(): Promise<void> {
  _panelOpen = !_panelOpen;
  const panel    = findEl('intel-panel');
  const backdrop = findEl('intel-backdrop');

  if (_panelOpen) {
    panel?.classList.add('open');
    backdrop?.classList.add('open');
    await _loadAndRender();
  } else {
    _closePanel();
  }
  haptic();
}

/* ── Panel helpers ───────────────────────────────────────────────────────── */

function _closePanel(): void {
  findEl('intel-panel')?.classList.remove('open');
  findEl('intel-backdrop')?.classList.remove('open');
  _panelOpen = false;
  document.dispatchEvent(new CustomEvent('modal:closed'));
}

function _bindEvents(): void {
  findEl('intel-close-btn')?.addEventListener('click', _closePanel);
  findEl('intel-backdrop')?.addEventListener('click', _closePanel);
  findEl('intel-refresh-btn')?.addEventListener('click', () => void _loadAndRender());
}

/* ── Algorithm ───────────────────────────────────────────────────────────── */

/**
 * Returns today's date as "YYYY-MM-DD" in local time.
 * Used both to exclude today's records from training and to set the
 * 30-day window floor.
 */
function _todayISO(): string {
  const d    = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Current time as decimal hours (e.g. 08:15:00 → 8.25). */
function _currentHour(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

/**
 * Gaussian bell curve centred on 0.
 * Returns 1.0 when hourDiff = 0, ~0.60 at ±1 h, ~0.08 at ±3 h.
 */
function _gauss(hourDiff: number): number {
  return Math.exp(-(hourDiff * hourDiff) / 2);
}

/**
 * Formats a decimal hour as "HH:MM" (e.g. 8.25 → "08:15").
 */
function _fmtHour(h: number): string {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60) % 24;
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Core scoring engine.
 *
 * @param entries  Raw history-all rows (already filtered to last 30 days,
 *                 today excluded — filtering happens in the caller).
 * @param todayIds Set of barcode IDs already processed today (excluded).
 * @returns        Top-5 candidates sorted by score descending.
 */
function _score(
  entries:  HistoryAllEntry[],
  todayIds: Set<string>,
): Candidate[] {
  const nowHour    = _currentHour();
  const nowMs      = Date.now();
  const msPerDay   = 86_400_000;

  // Group entries by barcode
  const groups = new Map<string, { name: string; hours: number[]; dayAges: number[] }>();

  for (const e of entries) {
    if (todayIds.has(e.barcode_id)) continue;           // already scanned today

    const dt = new Date(e.scanned_at);
    if (isNaN(dt.getTime())) continue;                  // malformed timestamp

    const decHour = dt.getHours() + dt.getMinutes() / 60 + dt.getSeconds() / 3600;
    const dayAge  = (nowMs - dt.getTime()) / msPerDay;  // days since scan

    const key = e.barcode_id;
    if (!groups.has(key)) {
      groups.set(key, { name: e.product_name || key, hours: [], dayAges: [] });
    }
    const g = groups.get(key)!;
    g.hours.push(decHour);
    g.dayAges.push(dayAge);
  }

  const candidates: Candidate[] = [];

  for (const [barcode, g] of groups) {
    const n = g.hours.length;
    if (n === 0) continue;

    // 1. Average hour (simple mean — circular mean not needed for <24h range)
    const avgHour = g.hours.reduce((s, h) => s + h, 0) / n;

    // 2. Time score — Gaussian proximity (dominant, ~70% of final score)
    const hourDiff  = Math.abs(nowHour - avgHour);
    const timeScore = _gauss(hourDiff);

    // 3. Frequency component: occurrences / 30 (normalised [0, 1])
    const freq30 = Math.min(n / 30, 1);

    // 4. Recency component: exponential decay sum, normalised [0, 1]
    //    exp(-dayAge) gives ~1 for today, ~0.37 at 1 day, ~0.05 at 3 days.
    //    We cap the sum at 10 to keep it in a sane range before normalising.
    const rawRecency = g.dayAges.reduce((s, age) => s + Math.exp(-age), 0);
    const recency    = Math.min(rawRecency / 10, 1);

    // 5. Base score (frequency + recency, 30% combined weight)
    const baseScore = freq30 * 0.20 + recency * 0.10;

    // 6. Final score
    const score = timeScore + baseScore;

    candidates.push({ barcode, name: g.name, avgHour, timeScore, score, freq: n });
  }

  // Sort descending, return top 5
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/* ── Data loading ────────────────────────────────────────────────────────── */

async function _loadAndRender(): Promise<void> {
  if (_loading) return;
  _loading = true;

  const listEl    = findEl('intel-list');
  const statusEl  = findEl('intel-status');
  if (listEl)   listEl.innerHTML   = '';
  if (statusEl) statusEl.textContent = 'Analysing...';

  try {
    // Training window: last 30 days (excluding today)
    const today   = _todayISO();
    const d30ago  = new Date(Date.now() - 30 * 86_400_000);
    const from    = `${d30ago.getFullYear()}-${String(d30ago.getMonth() + 1).padStart(2, '0')}-${String(d30ago.getDate()).padStart(2, '0')}`;

    // Fetch up to 2 000 rows from history-all for the window
    const data = await apiGetHistoryAll({ from, to: today, limit: 2000 });
    if (!data || data.entries.length === 0) {
      if (statusEl) statusEl.textContent = 'Not enough historical data yet.';
      if (listEl)   listEl.innerHTML     = '<p class="intel-empty">Scan more products to train the model.</p>';
      return;
    }

    // Exclude today's entries from training data
    const trainingEntries = data.entries.filter(e => {
      try {
        const d = new Date(e.scanned_at);
        if (isNaN(d.getTime())) return false;
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return iso !== today;
      } catch { return false; }
    });

    // Build the set of barcodes already scanned today (local history)
    const todayIds = new Set(getHistory().map(h => String(h.id)));

    const candidates = _score(trainingEntries, todayIds);

    if (statusEl) {
      statusEl.textContent =
        `${trainingEntries.length} records · ${new Set(trainingEntries.map(e => e.barcode_id)).size} products · now ${_fmtHour(_currentHour())}`;
    }

    _renderCandidates(candidates, listEl);
  } catch (err) {
    console.error('[Intelligence]', err);
    if (statusEl) statusEl.textContent = '⚠️ Error loading data.';
    if (listEl)   listEl.innerHTML     = '<p class="intel-empty">Check your connection.</p>';
  } finally {
    _loading = false;
  }
}

/* ── Render ──────────────────────────────────────────────────────────────── */

function _renderCandidates(candidates: Candidate[], listEl: HTMLElement | null): void {
  if (!listEl) return;

  if (candidates.length === 0) {
    listEl.innerHTML = '<p class="intel-empty">No predictions — all likely products already scanned today.</p>';
    return;
  }

  const frag = document.createDocumentFragment();

  candidates.forEach((c, idx) => {
    const confidence = Math.min(c.timeScore, 1);  // already [0,1] from Gauss
    const pct        = Math.round(confidence * 100);

    // Colour band: green ≥ 70, amber ≥ 40, red < 40
    const band = pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low';

    const card = document.createElement('div');
    card.className = 'intel-card';

    card.innerHTML = `
      <div class="intel-rank">#${idx + 1}</div>
      <div class="intel-body">
        <div class="intel-name">${_esc(c.name)}</div>
        <div class="intel-meta">
          <span class="intel-badge-time">⏱ Usual: ${_fmtHour(c.avgHour)}</span>
          <span class="intel-badge-freq">${c.freq}× / 30d</span>
        </div>
        <div class="intel-bar-wrap" title="Time confidence: ${pct}%">
          <div class="intel-bar intel-bar--${band}" style="width:${pct}%"></div>
        </div>
        <div class="intel-score-row">
          <span class="intel-score-label">Confidence</span>
          <span class="intel-score-val">${pct}%</span>
        </div>
      </div>
      <button class="intel-sped-btn" data-barcode="${_esc(c.barcode)}" title="Load in SPED">
        ▶ SPED
      </button>
    `;

    // Wire SPED button
    card.querySelector<HTMLButtonElement>('.intel-sped-btn')?.addEventListener('click', () => {
      haptic();
      _closePanel();
      // Small delay so the panel closes before SPED steals focus
      setTimeout(() => {
        document.dispatchEvent(
          new CustomEvent('sped:prefill', { detail: { productId: c.barcode } }),
        );
      }, 120);
    });

    frag.appendChild(card);
  });

  listEl.replaceChildren(frag);
}

/* ── HTML injection ──────────────────────────────────────────────────────── */

function _injectHTML(): void {
  if (findEl('intel-panel')) return; // already injected

  document.body.insertAdjacentHTML('beforeend', `
    <div id="intel-backdrop" class="intel-backdrop"></div>
    <div id="intel-panel" role="dialog" aria-modal="true" aria-label="Product Intelligence">
      <div class="intel-header">
        <span class="intel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Predictions
        </span>
        <div class="intel-header-actions">
          <button id="intel-refresh-btn" class="intel-icon-btn" title="Refresh predictions">
            <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
          <button id="intel-close-btn" class="intel-icon-btn" title="Close">
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <p id="intel-status" class="intel-status">Loading...</p>
      <div id="intel-list" class="intel-list"></div>
    </div>
  `);
}

/* ── Utility ─────────────────────────────────────────────────────────────── */

function _esc(s: string): string {
  return s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}
