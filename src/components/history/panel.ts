// ─── src/components/history/panel.ts ─────────────────────────────────────────
// SPED scan history — local panel (localStorage + D1 sync).

import {
  getHistory,
  clearHistory as svcClearHistory,
} from '@/services/historyService.ts';
import { copyToClipboard }   from '@/utils/clipboard.ts';
import { haptic, findEl }    from '@/utils/dom.ts';
import type { AppElements }  from '@/types/index.ts';

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
    // Notify SPED that the modal closed so it can return focus to #sped-barcode
    document.dispatchEvent(new CustomEvent('modal:closed'));
  }
  haptic();
}

export function clearHistory(): void {
  svcClearHistory();
  renderHistoryList();
  updateHistoryFilterCount();
  // Also reset the progress total so the counter starts fresh
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
      if (target.classList.contains('history-barcode')) return;

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

    // ── CC Qty / Pull Qty (mirrors historyAll display) ────────────────────
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

    // Small arrow hint
    const arrowEl = document.createElement('span');
    arrowEl.className   = 'history-prefill-hint';
    arrowEl.textContent = '→';
    arrowEl.title       = 'Load in SPED';

    row.append(timeEl, infoCol, arrowEl);
    frag.appendChild(row);
  });

  listEl.replaceChildren(frag);
}

export function updateHistoryFilterCount(): void {
  const countEl = findEl('history-filter-count');
  if (!countEl) return;
  const chk = findEl<HTMLInputElement>('sped-filter-history');
  const history = getHistory();

  if (chk?.checked && history.length > 0) {
    countEl.textContent    = `(${history.length} skipped)`;
    countEl.style.display  = 'inline';
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

/**
 * Updates the #sped-progress-counter element.
 * Shows "X done" when "Skip searched" is active and at least one product has been scanned.
 */
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
  
  // ✅ Eliminada la palabra "done". Si quieres mostrar solo el número, usa: `${done}`
  el.textContent   = ''; 
  el.style.display = 'inline';
}
