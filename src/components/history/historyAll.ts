// ─── src/components/history/historyAll.ts ────────────────────────────────────
// Cloud audit log panel — reads from D1 /api/history-all.

import { apiGetHistoryAll, apiClearHistoryAll } from '@/services/api.ts';
import { formatHistoryAllDate }  from '@/utils/format.ts';
import { copyToClipboard }       from '@/utils/clipboard.ts';
import { haptic, findEl }        from '@/utils/dom.ts';
import type { HistoryAllEntry }  from '@/types/index.ts';

let _entries: HistoryAllEntry[] = [];
let _panelOpen  = false;
let _loading    = false;

/* ── Public API ──────────────────────────────────────────────────────────── */

export async function toggleHistoryAllPanel(): Promise<void> {
  _panelOpen = !_panelOpen;
  const panel    = findEl('history-all-panel');
  const backdrop = findEl('history-all-backdrop');

  if (_panelOpen) {
    panel?.classList.add('open');
    backdrop?.classList.add('open');
    await loadHistoryAll();
  } else {
    panel?.classList.remove('open');
    backdrop?.classList.remove('open');
  }
  haptic();
}

export async function applyHistoryAllFilter(): Promise<void> {
  await loadHistoryAll();
}

export async function clearHistoryAll(): Promise<void> {
  _entries = [];
  renderHistoryAllList();
  const countEl = findEl('history-all-count');
  if (countEl) countEl.textContent = '0 entries';
  haptic();
  if (navigator.onLine) {
    apiClearHistoryAll().catch(() => undefined);
  }
}

/* ── Private ─────────────────────────────────────────────────────────────── */

async function loadHistoryAll(): Promise<void> {
  if (_loading) return;
  _loading = true;

  const listEl  = findEl('history-all-list');
  const countEl = findEl('history-all-count');
  if (listEl) listEl.innerHTML = '<p class="history-empty">Loading...</p>';

  const from = (findEl<HTMLInputElement>('history-all-from'))?.value ?? '';
  const to   = (findEl<HTMLInputElement>('history-all-to'))?.value   ?? '';

  try {
    const data = await apiGetHistoryAll({ from, to });
    if (!data) throw new Error('No data');

    _entries = data.entries;
    if (countEl) {
      countEl.textContent =
        `${data.total} entries${from || to ? ' (filtered)' : ''}`;
    }
    renderHistoryAllList();
  } catch {
    if (listEl) listEl.innerHTML = '<p class="history-empty">⚠️ Error loading. Check connection.</p>';
  } finally {
    _loading = false;
  }
}

function renderHistoryAllList(): void {
  const listEl = findEl('history-all-list');
  if (!listEl) return;

  if (_entries.length === 0) {
    listEl.innerHTML = '<p class="history-empty">No entries found.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  _entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'history-item history-all-item';

    const dateEl = document.createElement('span');
    dateEl.className   = 'history-all-date';
    dateEl.textContent = formatHistoryAllDate(entry.scanned_at);

    const barcodeEl = document.createElement('span');
    barcodeEl.className   = 'history-barcode';
    barcodeEl.textContent = entry.barcode_id;
    barcodeEl.title       = 'Tap to copy';
    barcodeEl.addEventListener('click', () => {
      copyToClipboard(entry.barcode_id);
      barcodeEl.classList.add('copied');
      setTimeout(() => barcodeEl.classList.remove('copied'), 800);
    });

    const nameEl = document.createElement('span');
    nameEl.className   = 'history-name';
    nameEl.textContent = entry.product_name || '—';

    const infoCol = document.createElement('div');
    infoCol.className = 'history-info-col';
    infoCol.append(barcodeEl, nameEl);

    if (entry.qty !== null && entry.qty !== undefined) {
      const qtyEl = document.createElement('span');
      qtyEl.className = 'history-all-qty';
      const parts = [`CC Qty: ${entry.qty}`];
      if (entry.pull_qty !== null && entry.pull_qty !== undefined) {
        parts.push(`Pull Qty: ${entry.pull_qty}`);
      }
      qtyEl.textContent = parts.join('  |  ');
      infoCol.append(qtyEl);
    }

    row.append(dateEl, infoCol);
    frag.appendChild(row);
  });

  listEl.replaceChildren(frag);
}
