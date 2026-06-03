// ─── src/components/history/panel.ts ─────────────────────────────────────────
// SPED scan history — local panel (localStorage + D1 sync).

import {
  getHistory,
  clearHistory as svcClearHistory,
  removeFromHistory,
} from '@/services/historyService.ts';
import { copyToClipboard }   from '@/utils/clipboard.ts';
import { haptic, findEl }    from '@/utils/dom.ts';
import type { AppElements, HistoryEntry }  from '@/types/index.ts';

let _panelOpen = false;

export function initHistoryPanel(_el: AppElements): void {
  void _el; // reserved for future direct element access
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
    document.dispatchEvent(new CustomEvent('modal:closed'));
  }
  haptic();
}

export function clearHistory(): void {
  const confirmed = window.confirm('Clear ALL history day? This cannot be undone.');
  if (!confirmed) return;
  svcClearHistory();
  renderHistoryList();
  updateHistoryFilterCount();
  try { localStorage.removeItem('fw_sped_total'); } catch { /* ignore */ }
  updateSpedProgressCounter();
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
    row.className = 'history-item history-item-clickable';
    row.title     = 'Tap to re-load this product in SPED';

    // Click on the whole row → pre-fill SPED
    row.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      // Ignore clicks on barcode, delete button and their children
      if (
        target.classList.contains('history-barcode') ||
        target.classList.contains('hall-del-btn') ||
        target.closest('.hall-del-btn')
      ) return;

      if (_panelOpen) toggleHistoryPanel();
      document.dispatchEvent(
        new CustomEvent<{ productId: string }>('sped:prefill', {
          detail: { productId: entry.id },
        }),
      );
    });

    const timeEl = document.createElement('span');
    timeEl.className   = 'history-time';
    timeEl.textContent = entry.time;

    const barcodeEl = document.createElement('span');
    barcodeEl.className   = 'history-barcode';
    barcodeEl.textContent = entry.id;
    barcodeEl.title       = 'Tap to copy';
    barcodeEl.addEventListener('click', e => {
      e.stopPropagation();
      copyToClipboard(entry.id);
      barcodeEl.classList.add('copied');
      setTimeout(() => barcodeEl.classList.remove('copied'), 800);
    });

    const nameEl = document.createElement('span');
    nameEl.className   = 'history-name';
    nameEl.textContent = entry.name || '—';

    const infoCol = document.createElement('div');
    infoCol.className = 'history-info-col';
    infoCol.append(barcodeEl, nameEl);

    // ── CC Qty / Pull Qty ─────────────────────────────────────────────────
    if (entry.qty !== null && entry.qty !== undefined) {
      const qtyEl = document.createElement('span');
      qtyEl.className = 'history-all-qty';
      const parts = [`CC Qty: ${entry.qty}`];
      if (entry.pullQty !== null && entry.pullQty !== undefined) {
        parts.push(`Pull Qty: ${entry.pullQty}`);
      }
      qtyEl.textContent = parts.join('  |  ');
      infoCol.append(qtyEl);
    }

    // ── Delete button ─────────────────────────────────────────────────────
    const delBtn = document.createElement('button');
    delBtn.className   = 'hall-del-btn';
    delBtn.textContent = '🗑';
    delBtn.title       = 'Delete this entry';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      _deleteEntry(entry, row);
    });

    row.append(timeEl, infoCol, delBtn);
    frag.appendChild(row);
  });

  listEl.replaceChildren(frag);
}

function _deleteEntry(entry: HistoryEntry, rowEl: HTMLElement): void {
  const label = entry.name || entry.id;
  const confirmed = window.confirm(`Delete entry for "${label}"?`);
  if (!confirmed) return;

  rowEl.style.opacity        = '0.4';
  rowEl.style.pointerEvents  = 'none';

  removeFromHistory(entry.id);

  // Animate out then remove from DOM
  rowEl.style.transition = 'opacity 0.2s';
  setTimeout(() => {
    rowEl.remove();
    // If list is now empty, show placeholder
    const listEl = findEl('history-list');
    if (listEl && listEl.children.length === 0) {
      listEl.innerHTML = '<p class="history-empty">No scanned barcodes yet.</p>';
    }
    updateHistoryFilterCount();
    updateSpedProgressCounter();
  }, 200);
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

/* ── Progress counter ────────────────────────────────────────────────────── */

export function updateSpedProgressCounter(): void {
  const el  = findEl('sped-progress-counter');
  const chk = findEl<HTMLInputElement>('sped-filter-history');
  if (!el) return;

  const filterOn = chk?.checked ?? false;
  const done     = getHistory().length;

  if (!filterOn || done === 0) {
    el.textContent   = '';
    el.style.display = 'none';
    return;
  }

  el.textContent   = '';
  el.style.display = 'inline';
}
