// ─── src/components/intelligence/intelligence.ts ──────────────────────────────
// Predictive product intelligence panel.
//
// Scoring model (per product, last 30 days of history-all, excluding today):
//   score = timeScore + baseScore
//
//   timeScore  (Gaussian bell curve, dominant)
//     avgHour   = mean decimal hour of historical scans  (08:15 → 8.25)
//     hourDiff  = |currentHour - avgHour|
//     timeScore = exp( -hourDiff² / 2 )
//
//   baseScore  (frequency + recency, 30% weight)
//     freq30    = occurrences in last 30 days / 30
//     recency   = Σ exp(-dayAge), capped & normalised
//     baseScore = freq30 * 0.20 + recency * 0.10
//
// Output:
//   · Up to 5 UPCOMING candidates  (avgHour >= currentHour)
//   · Up to 3 OVERDUE candidates   (avgHour <  currentHour, not yet scanned today)
//     — Overdue section is hidden when empty.
// ─────────────────────────────────────────────────────────────────────────────

import { apiGetHistoryAll } from '@/services/api.ts';
import { getHistory }       from '@/services/historyService.ts';
import { haptic, findEl }   from '@/utils/dom.ts';
import type { HistoryAllEntry } from '@/types/index.ts';

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface Candidate {
  readonly barcode:   string;
  readonly name:      string;
  /** Mean decimal hour across all historical scans (e.g. 8.25 = 08:15). */
  readonly avgHour:   number;
  /** Gaussian time-proximity score [0, 1]. */
  readonly timeScore: number;
  /** Combined final score. */
  readonly score:     number;
  /** Occurrences in the last 30 days. */
  readonly freq:      number;
  /** True when avgHour < currentHour — product should have been scanned already. */
  readonly isLate:    boolean;
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

function _todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _currentHour(): number {
  const n = new Date();
  return n.getHours() + n.getMinutes() / 60 + n.getSeconds() / 3600;
}

function _gauss(hourDiff: number): number {
  return Math.exp(-(hourDiff * hourDiff) / 2);
}

function _fmtHour(h: number): string {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60) % 24;
  const mm  = totalMin % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Scores all products and returns two sorted lists:
 *   upcoming — avgHour >= nowHour, top 5
 *   overdue  — avgHour <  nowHour (should already be scanned), top 3
 */
function _score(
  entries:  HistoryAllEntry[],
  todayIds: Set<string>,
): { upcoming: Candidate[]; overdue: Candidate[] } {
  const nowHour  = _currentHour();
  const nowMs    = Date.now();
  const msPerDay = 86_400_000;

  const groups = new Map<string, {
    name:     string;
    hours:    number[];
    dayAges:  number[];
  }>();

  for (const e of entries) {
    if (todayIds.has(e.barcode_id)) continue;

    const dt = new Date(e.scanned_at);
    if (isNaN(dt.getTime())) continue;

    const decHour = dt.getHours() + dt.getMinutes() / 60 + dt.getSeconds() / 3600;
    const dayAge  = (nowMs - dt.getTime()) / msPerDay;

    if (!groups.has(e.barcode_id)) {
      groups.set(e.barcode_id, { name: e.product_name || e.barcode_id, hours: [], dayAges: [] });
    }
    const g = groups.get(e.barcode_id)!;
    g.hours.push(decHour);
    g.dayAges.push(dayAge);
  }

  const upcoming: Candidate[] = [];
  const overdue:  Candidate[] = [];

  for (const [barcode, g] of groups) {
    const n = g.hours.length;
    if (n === 0) continue;

    const avgHour   = g.hours.reduce((s, h) => s + h, 0) / n;
    const hourDiff  = Math.abs(nowHour - avgHour);
    const timeScore = _gauss(hourDiff);
    const freq30    = Math.min(n / 30, 1);
    const rawRec    = g.dayAges.reduce((s, a) => s + Math.exp(-a), 0);
    const recency   = Math.min(rawRec / 10, 1);
    const baseScore = freq30 * 0.20 + recency * 0.10;
    const score     = timeScore + baseScore;
    const isLate    = avgHour < nowHour;

    const c: Candidate = { barcode, name: g.name, avgHour, timeScore, score, freq: n, isLate };

    if (isLate) overdue.push(c);
    else        upcoming.push(c);
  }

  return {
    upcoming: upcoming.sort((a, b) => b.score - a.score).slice(0, 5),
    overdue:  overdue.sort((a, b) => b.score - a.score).slice(0, 3),
  };
}

/* ── Data loading ────────────────────────────────────────────────────────── */

async function _loadAndRender(): Promise<void> {
  if (_loading) return;
  _loading = true;

  const listEl   = findEl('intel-list');
  const statusEl = findEl('intel-status');
  if (listEl)   listEl.innerHTML      = '';
  if (statusEl) statusEl.textContent  = 'Analysing…';

  try {
    const today  = _todayISO();
    const d30ago = new Date(Date.now() - 30 * 86_400_000);
    const from   = `${d30ago.getFullYear()}-${String(d30ago.getMonth() + 1).padStart(2, '0')}-${String(d30ago.getDate()).padStart(2, '0')}`;

    const data = await apiGetHistoryAll({ from, to: today, limit: 2000 });
    if (!data || data.entries.length === 0) {
      if (statusEl) statusEl.textContent = 'Not enough historical data yet.';
      if (listEl)   listEl.innerHTML     = '<p class="intel-empty">Scan more products to train the model.</p>';
      return;
    }

    const trainingEntries = data.entries.filter(e => {
      const d = new Date(e.scanned_at);
      if (isNaN(d.getTime())) return false;
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return iso !== today;
    });

    const todayIds  = new Set(getHistory().map(h => String(h.id)));
    const { upcoming, overdue } = _score(trainingEntries, todayIds);

    if (statusEl) {
      const uniq = new Set(trainingEntries.map(e => e.barcode_id)).size;
      statusEl.textContent = `${trainingEntries.length} records · ${uniq} products · ${_fmtHour(_currentHour())}`;
    }

    _renderAll(upcoming, overdue, listEl);
  } catch (err) {
    console.error('[Intelligence]', err);
    if (statusEl) statusEl.textContent = '⚠️ Error loading data.';
    if (listEl)   listEl.innerHTML     = '<p class="intel-empty">Check your connection.</p>';
  } finally {
    _loading = false;
  }
}

/* ── Render ──────────────────────────────────────────────────────────────── */

function _renderAll(
  upcoming: Candidate[],
  overdue:  Candidate[],
  listEl:   HTMLElement | null,
): void {
  if (!listEl) return;

  if (upcoming.length === 0 && overdue.length === 0) {
    listEl.innerHTML = '<p class="intel-empty">No predictions — all likely products already scanned today.</p>';
    return;
  }

  const frag = document.createDocumentFragment();

  // ── Upcoming ─────────────────────────────────────────────────────────────
  if (upcoming.length > 0) {
    const sec = document.createElement('p');
    sec.className   = 'intel-section-label';
    sec.textContent = '▲ Upcoming';
    frag.appendChild(sec);
    upcoming.forEach((c, i) => frag.appendChild(_buildCard(c, i + 1, false)));
  }

  // ── Overdue (only when there are any) ────────────────────────────────────
  if (overdue.length > 0) {
    const sec = document.createElement('p');
    sec.className   = 'intel-section-label intel-section-label--late';
    sec.textContent = '⚠ Overdue';
    frag.appendChild(sec);
    overdue.forEach((c, i) => frag.appendChild(_buildCard(c, i + 1, true)));
  }

  listEl.replaceChildren(frag);
}

function _buildCard(c: Candidate, rank: number, late: boolean): HTMLElement {
  const pct  = Math.round(Math.min(c.timeScore, 1) * 100);
  const band = pct >= 70 ? 'high' : pct >= 40 ? 'mid' : 'low';

  const card = document.createElement('div');
  card.className = late ? 'intel-card intel-card--late' : 'intel-card';

  card.innerHTML = `
    <div class="intel-rank${late ? ' intel-rank--late' : ''}">${rank}</div>
    <div class="intel-body">
      <div class="intel-row-top">
        <span class="intel-name">${_esc(c.name)}</span>
        <span class="intel-barcode">${_esc(c.barcode)}</span>
      </div>
      <div class="intel-row-mid">
        <span class="intel-badge-time">⏱ ${_fmtHour(c.avgHour)}</span>
        <span class="intel-badge-freq">${c.freq}×</span>
        <div class="intel-bar-wrap" title="Confidence: ${pct}%">
          <div class="intel-bar intel-bar--${band}" style="width:${pct}%"></div>
        </div>
        <span class="intel-pct">${pct}%</span>
      </div>
    </div>
    <button class="intel-sped-btn" title="Load in SPED">▶</button>
  `;

  card.querySelector<HTMLButtonElement>('.intel-sped-btn')?.addEventListener('click', () => {
    haptic();
    _closePanel();
    setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent('sped:prefill', { detail: { productId: c.barcode } }),
      );
    }, 120);
  });

  return card;
}

/* ── HTML injection ──────────────────────────────────────────────────────── */

function _injectHTML(): void {
  if (findEl('intel-panel')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div id="intel-backdrop" class="intel-backdrop"></div>
    <div id="intel-panel" role="dialog" aria-modal="true" aria-label="Product Intelligence">
      <div class="intel-header">
        <span class="intel-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Predictions
        </span>
        <div class="intel-header-actions">
          <button id="intel-refresh-btn" class="intel-icon-btn" title="Refresh">
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
      <p id="intel-status" class="intel-status">Loading…</p>
      <div id="intel-list" class="intel-list"></div>
    </div>
  `);
}

/* ── Utility ─────────────────────────────────────────────────────────────── */

function _esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
