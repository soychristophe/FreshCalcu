// ─── src/components/history/historyAll.ts ────────────────────────────────────
// Cloud audit log panel — reads from D1 /api/history-all.
// Adds a CSV export button when entries are loaded.
// Default date filter: current day (avoids loading the full log on open).

import { apiGetHistoryAll, apiClearHistoryAll, apiDeleteHistoryAllEntry } from '@/services/api.ts';
import { formatHistoryAllDate }  from '@/utils/format.ts';
import { copyToClipboard }       from '@/utils/clipboard.ts';
import { haptic, findEl }        from '@/utils/dom.ts';
import type { HistoryAllEntry }  from '@/types/index.ts';

let _entries: HistoryAllEntry[] = [];
let _panelOpen    = false;
let _loading      = false;
let _searchQuery  = '';
let _searchOpen   = false;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Returns today's date as "YYYY-MM-DD" in local time. */
function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Seeds the date-range inputs with today if they are still empty.
 * This keeps the filter intact when the user has already set custom dates
 * and merely closes/re-opens the panel.
 */
function seedDefaultDateFilter(): void {
  const fromEl = findEl<HTMLInputElement>('history-all-from');
  const toEl   = findEl<HTMLInputElement>('history-all-to');
  const today  = todayISO();

  if (fromEl && !fromEl.value) fromEl.value = today;
  if (toEl   && !toEl.value)   toEl.value   = today;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export async function toggleHistoryAllPanel(): Promise<void> {
  _panelOpen = !_panelOpen;
  const panel    = findEl('history-all-panel');
  const backdrop = findEl('history-all-backdrop');

  if (_panelOpen) {
    panel?.classList.add('open');
    backdrop?.classList.add('open');
    seedDefaultDateFilter();
    await loadHistoryAll();
  } else {
    panel?.classList.remove('open');
    backdrop?.classList.remove('open');
    // Notify SPED so it can reclaim focus if needed
    document.dispatchEvent(new CustomEvent('modal:closed'));
  }
  haptic();
}

export async function applyHistoryAllFilter(): Promise<void> {
  _searchQuery = '';
  _clearSearchInput();
  await loadHistoryAll();
}

export function toggleSearchDrawer(): void {
  _searchOpen = !_searchOpen;
  const drawer  = findEl('history-all-search-drawer');
  const iconBtn = findEl('history-all-search-btn');
  if (!drawer) return;
  if (_searchOpen) {
    drawer.classList.add('open');
    iconBtn?.classList.add('active');
    findEl<HTMLInputElement>('history-all-search-input')?.focus();
  } else {
    drawer.classList.remove('open');
    iconBtn?.classList.remove('active');
    _searchQuery = '';
    _clearSearchInput();
    renderHistoryAllList();
  }
  haptic();
}

export async function clearHistoryAll(): Promise<void> {
  const confirmed = window.confirm('Clear ALL history? This cannot be undone.');
  if (!confirmed) return;
  _entries = [];
  renderHistoryAllList();
  renderExportButton();
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
    renderExportButton();
    _wireSearchInput();
  } catch {
    if (listEl) listEl.innerHTML = '<p class="history-empty">⚠️ Error loading. Check connection.</p>';
    renderExportButton();
  } finally {
    _loading = false;
  }
}

function renderHistoryAllList(): void {
  const listEl = findEl('history-all-list');
  if (!listEl) return;

  const q = _searchQuery.trim().toLowerCase();
  const visible = q
    ? _entries.filter(e =>
        e.barcode_id.toLowerCase().includes(q) ||
        (e.product_name ?? '').toLowerCase().includes(q),
      )
    : _entries;

  if (visible.length === 0) {
    listEl.innerHTML = q
      ? '<p class="history-empty">No results for that search.</p>'
      : '<p class="history-empty">No entries found.</p>';
    return;
  }

  // Update count label to reflect filtered results
  const countEl = findEl('history-all-count');
  if (countEl) {
    const fromVal = (findEl<HTMLInputElement>('history-all-from'))?.value ?? '';
    const toVal   = (findEl<HTMLInputElement>('history-all-to'))?.value   ?? '';
    const dateTag = (fromVal || toVal) ? ' (filtered)' : '';
    const srchTag = q ? ` · "${_searchQuery}" → ${visible.length}` : '';
    countEl.textContent = `${_entries.length} entries${dateTag}${srchTag}`;
  }

  const frag = document.createDocumentFragment();
  visible.forEach(entry => {
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

    // ── Individual delete button ─────────────────────────────────────────
    const delBtn = document.createElement('button');
    delBtn.className   = 'hall-del-btn';
    delBtn.textContent = '🗑';
    delBtn.title       = 'Delete this entry';
    delBtn.addEventListener('click', () => void deleteHistoryAllEntry(entry, row));

    row.append(dateEl, infoCol, delBtn);
    frag.appendChild(row);
  });

  listEl.replaceChildren(frag);
}

async function deleteHistoryAllEntry(entry: HistoryAllEntry, rowEl: HTMLElement): Promise<void> {
  const label = entry.product_name || entry.barcode_id;
  const confirmed = window.confirm(`Delete entry for "${label}"?`);
  if (!confirmed) return;

  rowEl.style.opacity = '0.4';
  rowEl.style.pointerEvents = 'none';

  try {
    await apiDeleteHistoryAllEntry(entry.id);
    _entries = _entries.filter(e => e.id !== entry.id);
    rowEl.remove();
    const countEl = findEl('history-all-count');
    if (countEl) countEl.textContent = `${_entries.length} entries`;
    renderExportButton();
  } catch {
    rowEl.style.opacity = '';
    rowEl.style.pointerEvents = '';
    alert('Error deleting entry. Check connection.');
  }
}

/* ── Search helpers ──────────────────────────────────────────────────────── */

function _wireSearchInput(): void {
  const input = findEl<HTMLInputElement>('history-all-search-input');
  if (!input || input.dataset['searchWired']) return;
  input.dataset['searchWired'] = '1';
  input.addEventListener('input', () => {
    _searchQuery = input.value;
    renderHistoryAllList();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      _searchQuery = '';
      input.value  = '';
      renderHistoryAllList();
    }
  });
}

function _clearSearchInput(): void {
  const input = findEl<HTMLInputElement>('history-all-search-input');
  if (input) input.value = '';
}

/* ── CSV Export ──────────────────────────────────────────────────────────── */

/**
 * Injects / updates the Export CSV button in the history-all-panel header.
 * Button only renders when there are entries in memory.
 */
function renderExportButton(): void {
  const actionsEl = findEl('history-all-actions');
  if (!actionsEl) return;

  // Remove any existing export button
  actionsEl.querySelectorAll('.btn-hall-export').forEach(b => b.remove());

  if (_entries.length === 0) return;

  const btn = document.createElement('button');
  btn.className   = 'btn-hall-export btn-hall-apply';
  btn.textContent = '⬇ CSV';
  btn.title       = 'Export as CSV';
  btn.addEventListener('click', exportCSV);

  // Insert before the close button
  const closeBtn = findEl('history-all-close-btn') ?? actionsEl.lastElementChild;
  actionsEl.insertBefore(btn, closeBtn);

  // Inject search icon button if not already present
  if (!findEl('history-all-search-btn')) {
    const searchBtn = document.createElement('button');
    searchBtn.id        = 'history-all-search-btn';
    searchBtn.className = 'btn-hall-search';
    searchBtn.title     = 'Search by barcode or name';
    searchBtn.setAttribute('data-action', 'toggleSearchDrawer');
    searchBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>`;
    actionsEl.insertBefore(searchBtn, btn);
  }
}

function escapeCSVField(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in double-quotes if the value contains a comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportCSV(): void {
  const headers = ['Fecha', 'Hora', 'Barcode ID', 'Nombre producto', 'CC Qty', 'Pull Qty'];

  const rows = _entries.map(entry => {
    const dt = new Date(entry.scanned_at);
    const fecha = isNaN(dt.getTime())
      ? entry.scanned_at
      : dt.toLocaleDateString();
    const hora  = isNaN(dt.getTime())
      ? ''
      : dt.toLocaleTimeString();

    return [
      escapeCSVField(fecha),
      escapeCSVField(hora),
      escapeCSVField(entry.barcode_id),
      escapeCSVField(entry.product_name),
      escapeCSVField(entry.qty),
      escapeCSVField(entry.pull_qty),
    ].join(',');
  });

  const csv      = [headers.join(','), ...rows].join('\r\n');
  const blob     = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const today    = new Date().toISOString().split('T')[0] ?? 'export';
  const filename = `freshways-history-${today}.csv`;

  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
