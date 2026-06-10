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
let _panelOpen   = false;
let _loading     = false;
let _searchQuery = '';
let _searchOpen  = false;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Returns today's date as "YYYY-MM-DD" in local time. */
function todayISO(): string {
  const d    = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Seeds the date-range inputs with today if they are still empty.
 * Keeps the filter intact when the user closes/re-opens the panel.
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
    ensureSearchDrawer();    // create drawer before any render
    ensureSearchButton();    // create search button (idempotent)
    await loadHistoryAll();
  } else {
    panel?.classList.remove('open');
    backdrop?.classList.remove('open');
    // Reset search state for next open
    _searchOpen  = false;
    _searchQuery = '';
    const input = findEl<HTMLInputElement>('history-all-search-input');
    if (input) input.value = '';
    findEl('history-all-search-drawer')?.classList.remove('open');
    findEl('history-all-search-btn')?.classList.remove('active');
    document.dispatchEvent(new CustomEvent('modal:closed'));
  }
  haptic();
}

export async function applyHistoryAllFilter(): Promise<void> {
  await loadHistoryAll();
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

/* ── Search drawer ───────────────────────────────────────────────────────── */

/**
 * Injects the search drawer into the DOM right after the date-filter bar.
 * Idempotent — safe to call multiple times.
 */
function ensureSearchDrawer(): void {
  if (findEl('history-all-search-drawer')) return;

  const filterBar = findEl('history-all-filter');
  if (!filterBar || !filterBar.parentElement) return;

  const drawer = document.createElement('div');
  drawer.id        = 'history-all-search-drawer';
  drawer.className = 'history-all-search-drawer';

  const input = document.createElement('input');
  input.type         = 'text';
  input.id           = 'history-all-search-input';
  input.className    = 'history-all-search-input';
  input.placeholder  = 'Buscar por ID o nombre…';
  input.autocomplete = 'off';
  input.spellcheck   = false;
  input.addEventListener('input', () => {
    _searchQuery = input.value;
    renderHistoryAllList();
    updateSearchCount();
  });

  const clearBtn = document.createElement('button');
  clearBtn.className   = 'btn-hall-search-clear';
  clearBtn.textContent = '✕';
  clearBtn.title       = 'Limpiar búsqueda';
  clearBtn.addEventListener('click', () => {
    input.value  = '';
    _searchQuery = '';
    renderHistoryAllList();
    updateSearchCount();
    input.focus();
  });

  const countEl = document.createElement('span');
  countEl.id        = 'history-all-search-count';
  countEl.className = 'history-all-search-count';

  drawer.append(input, clearBtn, countEl);
  filterBar.insertAdjacentElement('afterend', drawer);
}

/**
 * Injects the search (lupa) button into history-all-actions, to the left of
 * the close button. Idempotent — safe to call multiple times.
 */
function ensureSearchButton(): void {
  if (findEl('history-all-search-btn')) return;

  const actionsEl = findEl('history-all-actions');
  if (!actionsEl) return;

  const closeBtn = findEl('history-all-close-btn') ?? actionsEl.lastElementChild;

  const searchBtn = document.createElement('button');
  searchBtn.id          = 'history-all-search-btn';
  searchBtn.className   = 'btn-hall-search';
  searchBtn.textContent = '🔍';
  searchBtn.title       = 'Buscar por ID o nombre';
  searchBtn.addEventListener('click', toggleSearchDrawer);
  actionsEl.insertBefore(searchBtn, closeBtn);
}

function updateSearchCount(): void {
  const countEl = findEl('history-all-search-count');
  if (!countEl) return;
  if (!_searchQuery.trim()) {
    countEl.textContent = '';
    return;
  }
  const q       = _searchQuery.trim().toLowerCase();
  const matched = _entries.filter(e =>
    e.barcode_id.toLowerCase().includes(q) ||
    (e.product_name ?? '').toLowerCase().includes(q),
  ).length;
  countEl.textContent = `${matched} / ${_entries.length}`;
}

function toggleSearchDrawer(): void {
  _searchOpen = !_searchOpen;

  const drawer = findEl('history-all-search-drawer');
  const btn    = findEl('history-all-search-btn');

  if (_searchOpen) {
    drawer?.classList.add('open');
    btn?.classList.add('active');
    const input = findEl<HTMLInputElement>('history-all-search-input');
    setTimeout(() => input?.focus(), 80);
  } else {
    drawer?.classList.remove('open');
    btn?.classList.remove('active');
    _searchQuery = '';
    const input = findEl<HTMLInputElement>('history-all-search-input');
    if (input) input.value = '';
    renderHistoryAllList();
    updateSearchCount();
  }
  haptic();
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
    updateSearchCount();
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

  // Case-insensitive filter by barcode ID or product name
  const q = _searchQuery.trim().toLowerCase();
  const visible = q
    ? _entries.filter(e =>
        e.barcode_id.toLowerCase().includes(q) ||
        (e.product_name ?? '').toLowerCase().includes(q),
      )
    : _entries;

  if (visible.length === 0) {
    listEl.innerHTML = `<p class="history-empty">${
      q ? 'Sin resultados para esa búsqueda.' : 'No entries found.'
    }</p>`;
    return;
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
  const label     = entry.product_name || entry.barcode_id;
  const confirmed = window.confirm(`Delete entry for "${label}"?`);
  if (!confirmed) return;

  rowEl.style.opacity       = '0.4';
  rowEl.style.pointerEvents = 'none';

  try {
    await apiDeleteHistoryAllEntry(entry.id);
    _entries = _entries.filter(e => e.id !== entry.id);
    rowEl.remove();
    const countEl = findEl('history-all-count');
    if (countEl) countEl.textContent = `${_entries.length} entries`;
    renderExportButton();
  } catch {
    rowEl.style.opacity       = '';
    rowEl.style.pointerEvents = '';
    alert('Error deleting entry. Check connection.');
  }
}

/* ── CSV Export ──────────────────────────────────────────────────────────── */

/**
 * Renders (or removes) the CSV export button.
 * The search button is managed separately by ensureSearchButton() — this
 * function no longer touches it, avoiding the re-creation loop that was
 * breaking the toggle state.
 */
function renderExportButton(): void {
  const actionsEl = findEl('history-all-actions');
  if (!actionsEl) return;

  // Remove only the export button (search button stays)
  actionsEl.querySelectorAll('.btn-hall-export').forEach(b => b.remove());

  // Export CSV — only when there are entries
  if (_entries.length > 0) {
    const searchBtn = findEl('history-all-search-btn');
    const closeBtn  = findEl('history-all-close-btn') ?? actionsEl.lastElementChild;
    const anchor    = searchBtn ?? closeBtn;

    const exportBtn = document.createElement('button');
    exportBtn.className   = 'btn-hall-export btn-hall-apply';
    exportBtn.textContent = '⬇ CSV';
    exportBtn.title       = 'Export as CSV';
    exportBtn.addEventListener('click', exportCSV);
    actionsEl.insertBefore(exportBtn, anchor);
  }
}

function escapeCSVField(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportCSV(): void {
  const headers = ['Fecha', 'Hora', 'Barcode ID', 'Nombre producto', 'CC Qty', 'Pull Qty'];

  const rows = _entries.map(entry => {
    const dt    = new Date(entry.scanned_at);
    const fecha = isNaN(dt.getTime()) ? entry.scanned_at : dt.toLocaleDateString();
    const hora  = isNaN(dt.getTime()) ? ''               : dt.toLocaleTimeString();

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
