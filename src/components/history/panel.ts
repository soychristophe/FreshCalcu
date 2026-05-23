// ─── src/components/history/panel.ts ─────────────────────────────────────────
// SPED scan history — local panel (localStorage + D1 sync).
//
// CHANGE LOG (history-row quick-jump):
//   • Added HistoryClickFn type and _onHistoryClick callback slot.
//   • Added setHistoryClickCallback() — called by initSped() to register the
//     handler without creating a circular import.
//   • renderHistoryList() now makes each row tappable:
//       - clicking the barcode badge → copies to clipboard (existing behaviour)
//       - clicking anywhere else on the row → closes panel + invokes callback

import {
  getHistory,
  clearHistory as svcClearHistory,
} from '@/services/historyService.ts';
import { copyToClipboard }   from '@/utils/clipboard.ts';
import { haptic, findEl }    from '@/utils/dom.ts';
import type { AppElements }  from '@/types/index.ts';

let _el: AppElements;
let _panelOpen = false;

/* ── Callback slot (avoids circular import with sped/index.ts) ───────────── */

type HistoryClickFn = (id: string, name: string) => void;
let _onHistoryClick: HistoryClickFn | null = null;

/**
 * Register the function that handles a history-row tap.
 * Called once from initSped() so panel.ts never imports sped/index.ts.
 *
 * @param fn  Receives the entry's barcode id and product name.
 */
export function setHistoryClickCallback(fn: HistoryClickFn): void {
  _onHistoryClick = fn;
}

/* ── Init ────────────────────────────────────────────────────────────────── */

export function initHistoryPanel(el: AppElements): void {
  _el = el;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export function toggleHistoryPanel(): void {
  _panelOpen = !_panelOpen;
  const panel    = findEl('history-panel');
  const backdrop = findEl('history-backdrop');

  if (_panelOpen) {
    renderHistoryList();
    panel?.classList.add('open');
    backdrop?.classList.add('open');
  } else {
    panel?.classList.remove('open');
    backdrop?.classList.remove('open');
  }
  haptic();
}

export function clearHistory(): void {
  svcClearHistory();
  renderHistoryList();
  updateHistoryFilterCount();
  haptic();
}

export function renderHistoryList(): void {
  const listEl = findEl('history-list');
  if (!listEl) return;

  const history = getHistory();

  if (history.length === 0) {
    listEl.innerHTML = '<p class="history-empty">No scanned barcodes yet.</p>';
    return;
  }

  const frag = document.createDocumentFragment();

  history.forEach(entry => {
    const row = document.createElement('div');
    // history-item-clickable adds `cursor:pointer` and a hover tint via CSS.
    // If you prefer not to add a new class, add `row.style.cursor='pointer'`
    // instead and keep a single class name.
    row.className = 'history-item history-item-clickable';

    /* ── Time stamp ─────────────────────────────────────────────────────── */
    const timeEl = document.createElement('span');
    timeEl.className   = 'history-time';
    timeEl.textContent = entry.time;

    /* ── Barcode badge — tap copies, does NOT navigate ───────────────────── */
    const barcodeEl = document.createElement('span');
    barcodeEl.className   = 'history-barcode';
    barcodeEl.textContent = entry.id;
    barcodeEl.title       = 'Tap to copy';
    barcodeEl.addEventListener('click', e => {
      e.stopPropagation();   // ← prevents the row's click from firing
      copyToClipboard(entry.id);
      barcodeEl.classList.add('copied');
      setTimeout(() => barcodeEl.classList.remove('copied'), 800);
    });

    /* ── Product name ───────────────────────────────────────────────────── */
    const nameEl = document.createElement('span');
    nameEl.className   = 'history-name';
    nameEl.textContent = entry.name || '—';

    const infoCol = document.createElement('div');
    infoCol.className = 'history-info-col';
    infoCol.append(barcodeEl, nameEl);

    row.append(timeEl, infoCol);

    /* ── Row tap → close panel + jump to SPED step 2 ────────────────────── */
    row.addEventListener('click', () => {
      if (!_onHistoryClick) return;
      // Close the panel first so the animation plays while the lookup runs.
      if (_panelOpen) toggleHistoryPanel();
      _onHistoryClick(entry.id, entry.name ?? '');
    });

    frag.appendChild(row);
  });

  listEl.replaceChildren(frag);
}

export function updateHistoryFilterCount(): void {
  const countEl = findEl('history-filter-count');
  if (!countEl) return;
  const chk     = findEl<HTMLInputElement>('sped-filter-history');
  const history = getHistory();

  if (chk?.checked && history.length > 0) {
    countEl.textContent   = `(${history.length} skipped)`;
    countEl.style.display = 'inline';
  } else {
    countEl.style.display = 'none';
  }
}

export function isFilterHistoryOn(): boolean {
  return (findEl<HTMLInputElement>('sped-filter-history')?.checked) ?? false;
}

export function getHistoryIds(): string[] {
  return getHistory().map(h => String(h.id));
}
