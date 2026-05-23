// ─── src/components/sped/index.ts ────────────────────────────────────────────
// SPED tab orchestrator — wires together search, step navigation,
// formula calculation, and result display.
//
// CHANGE LOG (history-row quick-jump):
//   • Exported jumpToSpedFromHistory(id, name):
//       - Resets SPED state without the focus side-effect of resetSped().
//       - Looks up the product via findProduct() (cache-first, offline-safe).
//       - Found     → sets selectedProduct, renders product info, goes to step 2.
//       - Not found → fills #sped-barcode and shows step 1 for manual search.
//   • initSped() now calls setHistoryClickCallback(jumpToSpedFromHistory) so
//     panel.ts can invoke the jump without importing this module directly
//     (avoids the sped → panel → sped circular dependency).

import { state }               from '@/state/appState.ts';
import { findProduct }         from '@/services/productCache.ts';
import { apiAddHistoryAll }    from '@/services/api.ts';
import {
  addToHistory,
  getHistory,
}                              from '@/services/historyService.ts';
import {
  renderHistoryList,
  updateHistoryFilterCount,
  isFilterHistoryOn,
  setHistoryClickCallback,
}                              from '@/components/history/panel.ts';
import {
  refresh as calcRefresh,
}                              from '@/components/calculator.ts';
import { switchTab }           from '@/components/navigation.ts';
import {
  safeEval,
  pickBestFormula,
  computeCrateCalc,
  getRemainderFormula,
}                              from '@/utils/math.ts';
import { copyToClipboard }     from '@/utils/clipboard.ts';
import { pasteFromClipboard }  from '@/utils/clipboard.ts';
import { haptic, make, fitText, setError, findEl } from '@/utils/dom.ts';
import { SEARCH_DEBOUNCE_MS }  from '@/config/constants.ts';
import type { AppElements, Product, SpedView } from '@/types/index.ts';

let _el: AppElements;
let _copyToast: () => void;

/* ── Init ────────────────────────────────────────────────────────────────── */

export function initSped(el: AppElements, showCopyToast: () => void): void {
  _el        = el;
  _copyToast = showCopyToast;

  _el.spedBarcode.addEventListener('keydown', e => { if (e.key === 'Enter') void nextSped(); });
  _el.spedBarcode.addEventListener('input',   () => handleBarcodeInput());

  _el.spedQty.addEventListener('keydown', e => {
    if (e.key === 'Enter')     { processSped(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _el.pullQty?.focus(); }
  });
  _el.pullQty.addEventListener('keydown', e => {
    if (e.key === 'Enter')   { processSped(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); _el.spedQty.focus(); }
  });

  document.addEventListener('click', e => {
    const target = e.target as Node;
    if (!_el.spedBarcode.contains(target) && !_el.spedSuggestions.contains(target)) {
      _el.spedSuggestions.replaceChildren();
    }
  });

  // History filter toggle
  findEl<HTMLInputElement>('sped-filter-history')?.addEventListener('change', () => {
    updateHistoryFilterCount();
    _el.spedBarcode.dispatchEvent(new Event('input'));
  });

  // Register the history-row quick-jump handler in panel.ts.
  // This keeps panel.ts free of any import from sped/index.ts, avoiding
  // a circular module dependency.
  setHistoryClickCallback((id, name) => void jumpToSpedFromHistory(id, name));
}

/* ── View management ─────────────────────────────────────────────────────── */

export function setSpedView(view: SpedView | string): void {
  const map: Record<string, HTMLElement | null> = {
    'step1':       _el.spedStep1,
    'step2':       _el.spedStep2,
    'calc-result': _el.spedCalcResult,
    'pull-result': _el.spedPullResult,
  };
  Object.values(map).forEach(node => { if (node) node.style.display = 'none'; });
  const target = map[view];
  if (target) target.style.display = 'flex';
  state.spedCurrentView = view as SpedView;

  requestAnimationFrame(() => {
    if (view === 'step1') _el.spedBarcode.focus();
    else if (view === 'step2') _el.spedQty.focus();
  });
}

/* ── Step navigation ─────────────────────────────────────────────────────── */

export function resetSped(): void {
  _el.spedBarcode.value = '';
  _el.spedProductName.textContent = '';
  _el.spedSuggestions.replaceChildren();
  _el.spedProductInfo.replaceChildren();
  findEl('sped-product-info-pull')?.replaceChildren();
  setError(_el.spedError1);
  setError(_el.spedError2);
  setError(findEl('pull-error-step3'));
  _el.spedStep1.classList.remove('is-searching');
  setSpedView('step1');
  state.selectedProduct  = null;
  state.spedOriginalCalc = null;
  state.spedPullCalc     = null;
  if (_el.pullQty) (_el.pullQty as HTMLInputElement).value = '';
  setTimeout(() => _el.spedBarcode.focus(), 100);
}

export function cancelSped(): void { haptic(); switchTab('calc'); }

export function backSped(): void {
  _el.spedBarcode.value = '';
  _el.spedStep1.classList.remove('is-searching');
  setSpedView('step1');
  setError(_el.spedError2);
  _el.spedBarcode.focus();
}

export function backToStep2FromCalcResult(): void {
  setSpedView('step2');
  _el.spedQty.focus();
}

export function backToStep2FromPullResult(): void {
  setSpedView('step2');
  _el.spedQty.focus();
}

/* ── History-row quick-jump ──────────────────────────────────────────────── */

/**
 * Invoked when the user taps a row in the "History Day" panel.
 *
 * Flow:
 *   1. Switch to SPED tab (no-op if already active).
 *   2. Clear any previous SPED state (without the focus side-effect
 *      of resetSped's inner setTimeout).
 *   3. Look up the product in the local cache (findProduct is cache-first
 *      and works offline after the first load).
 *   4a. Product found     → set as selectedProduct, render info, go to step 2.
 *       The qty field is cleared and focused — user only needs to type the
 *       new amount.
 *   4b. Product not found → pre-fill #sped-barcode with the ID and show
 *       step 1 so the existing search/manual flow takes over.
 *
 * @param id    Barcode / product ID stored in the history entry.
 * @param name  Product name stored in the history entry (used as fallback
 *              label when the product can't be found in the cache).
 */
export async function jumpToSpedFromHistory(id: string, name: string): Promise<void> {
  haptic();

  // 1 — Ensure we're on the SPED tab
  switchTab('sped');

  // 2 — Reset visual state without resetSped()'s setTimeout focus race.
  //     We replicate only the DOM/state teardown and let setSpedView() below
  //     handle the correct focus via its own requestAnimationFrame.
  _el.spedBarcode.value = '';
  _el.spedProductName.textContent = '';
  _el.spedSuggestions.replaceChildren();
  _el.spedProductInfo.replaceChildren();
  findEl('sped-product-info-pull')?.replaceChildren();
  setError(_el.spedError1);
  setError(_el.spedError2);
  setError(findEl('pull-error-step3'));
  _el.spedStep1.classList.remove('is-searching');
  (_el.spedQty as HTMLInputElement).value  = '';
  (_el.pullQty as HTMLInputElement).value  = '';
  state.selectedProduct  = null;
  state.spedOriginalCalc = null;
  state.spedPullCalc     = null;

  // 3 — Cache lookup (sync when cache is warm; one API call when it isn't)
  const product = await findProduct(id);

  if (product) {
    // 4a — Happy path: product is in cache → land directly on step 2
    state.selectedProduct           = product;
    _el.spedBarcode.value           = String(product.id);
    _el.spedProductName.textContent = product.name ?? '';
    renderSpedProductInfo();
    // setSpedView('step2') will focus #sped-qty via requestAnimationFrame
    setSpedView('step2');
  } else {
    // 4b — Product missing from cache → pre-fill barcode, let step 1 handle it
    _el.spedBarcode.value           = id;
    _el.spedProductName.textContent = name || '';
    _el.spedStep1.classList.toggle('is-searching', id.length > 0);
    // setSpedView('step1') will focus #sped-barcode via requestAnimationFrame
    setSpedView('step1');
  }
}

/* ── Clipboard paste ─────────────────────────────────────────────────────── */

export async function pasteClipboard(): Promise<void> {
  const text = await pasteFromClipboard();
  if (!text) return;
  _el.spedBarcode.value = text;
  const exact = await findProduct(text);
  if (exact) {
    copyToClipboard(exact.id, _copyToast);
    await nextSped();
  }
}

/* ── Step 1: barcode lookup ──────────────────────────────────────────────── */

export async function nextSped(): Promise<void> {
  const barcode = _el.spedBarcode.value.trim();
  setError(_el.spedError1);
  if (!barcode) { setError(_el.spedError1, 'Enter a barcode.'); return; }

  const product = await findProduct(barcode);
  if (!product) {
    setError(_el.spedError1, `Product not found: ${barcode}`);
    _el.spedStep1.classList.remove('is-searching');
    // Save to local history if barcode looks valid
    if (/^\d{10,15}$/.test(barcode)) {
      addToHistory({ id: barcode, name: 'Product not found', values: [], sku: undefined });
      renderHistoryList();
      updateHistoryFilterCount();
    }
    return;
  }

  state.selectedProduct = product;
  addToHistory(product);
  renderHistoryList();
  updateHistoryFilterCount();
  setSpedView('step2');
  _el.spedQty.focus();
  renderSpedProductInfo();
}

/* ── Product info block ──────────────────────────────────────────────────── */

function renderSpedProductInfo(): void {
  const { id, name = 'No name', values = [] } = state.selectedProduct ?? {};

  const buildInfoBlock = (): Node[] => {
    const barcodeEl  = make('div', { className: 'sped-barcode-badge', textContent: `🔖 ${id ?? ''}` });
    const nameEl     = make('h4', { textContent: name });
    const formulasEl = values.length
      ? make('div', { className: 'sped-formulas' },
          ...values.map(v => make('span', { className: 'sped-formula-tag', textContent: v })),
        )
      : make('p', {
          textContent: 'No defined formulas',
          // @ts-expect-error inline style for optional elements
          style: 'color:#999;font-size:0.9rem;margin:5px 0 0 0;',
        });
    return [barcodeEl, nameEl, formulasEl];
  };

  _el.spedProductInfo.replaceChildren(...buildInfoBlock());
  findEl('sped-product-info-pull')?.replaceChildren(...buildInfoBlock());
}

/* ── Step 2: formula processing ──────────────────────────────────────────── */

export function processSped(): void {
  setError(_el.spedError2);
  const qty = parseFloat((_el.spedQty as HTMLInputElement).value);

  if (!state.selectedProduct)        { setError(_el.spedError2, 'Internal error: no product selected.'); return; }
  if (isNaN(qty) || qty <= 0)        { setError(_el.spedError2, 'Please enter a valid amount.'); return; }

  const best = pickBestFormula(state.selectedProduct.values, qty);
  if (!best)                         { setError(_el.spedError2, 'A disposition could not be calculated.'); return; }

  const calc = computeCrateCalc(best, qty);
  if (!calc)                         { setError(_el.spedError2, 'The formula is not valid.'); return; }

  // Push the formula into the calculator display
  state.calcVal = best;
  state.boxVal  = qty.toString();
  calcRefresh();

  state.spedOriginalCalc = {
    product:    state.selectedProduct,
    totalUnits: qty,
    formula:    best,
    divisor:    calc.divisor,
    full:       calc.full,
    rem:        calc.rem,
  };

  const pullQtyVal = parseFloat((_el.pullQty as HTMLInputElement)?.value ?? '');

  if (!isNaN(pullQtyVal) && pullQtyVal > 0) {
    renderPullResult(qty, best, calc, pullQtyVal);
  } else {
    renderCalcResult(qty, best, calc);
  }
}

/* ── Calc result view ────────────────────────────────────────────────────── */

function renderCalcResult(
  qty:  number,
  best: string,
  calc: { divisor: number; full: number; rem: number },
): void {
  const product = state.selectedProduct!;
  const remFormula = getRemainderFormula(best, calc.rem);

  setText('calc-rem-formula',    remFormula ? `${remFormula}` : '');
  setText('calc-product-name',   product.name || product.id);
  setText('calc-formula',        `${best} = ${safeEval(best)}`);
  setText('calc-total-units',    String(qty));
  setText('calc-full',           String(calc.full));
  setText('calc-rem',            String(calc.rem));

  fitText(findEl('calc-formula'), 30, 12);
  applySubCrateMode('calc', calc.full === 0);
  setSpedView('calc-result');

  // Cloud audit log (fire-and-forget)
  if (navigator.onLine) {
    apiAddHistoryAll(String(product.id), product.name ?? '', qty, null).catch(() => undefined);
  }
}

/* ── Pull result view ────────────────────────────────────────────────────── */

function renderPullResult(
  qty:        number,
  best:       string,
  calc:       { divisor: number; full: number; rem: number },
  pullQtyVal: number,
): void {
  const product = state.selectedProduct!;

  const pullFormula = pickBestFormula(product.values, pullQtyVal);
  if (!pullFormula)  { setError(_el.spedError2, 'No formula available for Pull Forward quantity.'); return; }

  const pullCalc = computeCrateCalc(pullFormula, pullQtyVal);
  if (!pullCalc)     { setError(_el.spedError2, 'Error calculating Pull Forward formula.'); return; }

  state.spedPullCalc = {
    formula:    pullFormula,
    totalUnits: pullQtyVal,
    full:       pullCalc.full,
    rem:        pullCalc.rem,
  };

  const todayRemFormula = getRemainderFormula(best, calc.rem);
  const pullRemFormula  = getRemainderFormula(pullFormula, pullCalc.rem);

  setText('pull-today-rem-formula', todayRemFormula);
  setText('pull-pull-rem-formula',  pullRemFormula);
  setText('pull-today-product',     product.name || product.id);
  setText('pull-today-formula',     `${best} = ${safeEval(best)}`);
  setText('pull-today-units',       String(qty));
  setText('pull-today-full',        String(calc.full));
  setText('pull-today-rem',         String(calc.rem));
  setText('pull-pull-product',      product.name || product.id);
  setText('pull-pull-formula',      `${pullFormula} = ${safeEval(pullFormula)}`);
  setText('pull-pull-units',        String(pullQtyVal));
  setText('pull-pull-full',         String(pullCalc.full));
  setText('pull-pull-rem',          String(pullCalc.rem));

  fitText(findEl('pull-today-formula'), 28, 12);
  fitText(findEl('pull-pull-formula'),  28, 12);

  applySubCrateMode('today', calc.full === 0);
  applySubCrateMode('pull',  pullCalc.full === 0);
  setSpedView('pull-result');

  // Cloud audit log (fire-and-forget)
  if (navigator.onLine) {
    apiAddHistoryAll(String(product.id), product.name ?? '', qty, pullQtyVal).catch(() => undefined);
  }
}

/* ── Send to calculator ──────────────────────────────────────────────────── */

export function sendTodayToCalcu(): void {
  if (!state.spedOriginalCalc) return;
  haptic();
  state.calcVal = state.spedOriginalCalc.formula;
  state.boxVal  = state.spedOriginalCalc.totalUnits.toString();
  calcRefresh();
  switchTab('calc');
}

export function sendPullToCalcu(): void {
  if (!state.spedPullCalc) return;
  haptic();
  state.calcVal = state.spedPullCalc.formula;
  state.boxVal  = state.spedPullCalc.totalUnits.toString();
  calcRefresh();
  switchTab('calc');
}

/* ── Sub-crate layout helper ─────────────────────────────────────────────── */

function applySubCrateMode(prefix: string, isSub: boolean): void {
  findEl(`${prefix}-row1`)?.style.setProperty('display', isSub ? 'none' : '');
  findEl(`${prefix}-formula-card`)?.style.setProperty('display', isSub ? 'none' : '');
  const row2 = findEl(`${prefix}-row2`);
  if (row2) row2.style.gridTemplateColumns = isSub ? '1fr' : '';
}

/* ── Barcode input & suggestions ─────────────────────────────────────────── */

let _searchTimer: ReturnType<typeof setTimeout> | null = null;

function handleBarcodeInput(): void {
  const query = _el.spedBarcode.value.trim();
  _el.spedSuggestions.replaceChildren();
  _el.spedProductName.textContent = '';
  _el.spedStep1.classList.toggle('is-searching', query.length > 0);
  if (!query) return;

  if (_searchTimer !== null) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => void runSearch(query), SEARCH_DEBOUNCE_MS);
}

async function runSearch(query: string): Promise<void> {
  if (_el.spedBarcode.value.trim() !== query) return;

  const filterOn   = isFilterHistoryOn();
  const historyIds = filterOn ? getHistory().map(h => String(h.id)) : [];

  // ── Exact match → skip to step 2 immediately ─────────────────────────────
  try {
    const exact = await findProduct(query);
    if (exact && String(exact.id).trim() === query) {
      copyToClipboard(exact.id, _copyToast);
      if (_el.spedBarcode.value.trim() === query) selectSuggestion(exact);
      return;
    }
  } catch {
    /* continue to suggestion list */
  }

  // ── Fuzzy suggestions ─────────────────────────────────────────────────────
  let matches: Product[] = [];
  try {
    const { searchProducts } = await import('@/services/productCache.ts');
    matches = await searchProducts(query, { exclude: historyIds });
  } catch {
    matches = [];
  }

  if (_el.spedBarcode.value.trim() !== query) return;

  if (matches.length === 1) {
    selectSuggestion(matches[0]);
    return;
  }

  const frag = document.createDocumentFragment();

  matches.forEach(match => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    const idSpan   = document.createElement('span');
    idSpan.className   = 'sug-id';
    idSpan.textContent = String(match.id);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'sug-name';
    if (match.name) {
      nameSpan.textContent = match.name;
    } else {
      nameSpan.append(document.createElement('em'));
      (nameSpan.firstChild as HTMLElement).textContent = 'No name';
    }
    div.append(idSpan, nameSpan);
    div.addEventListener('click', () => selectSuggestion(match));
    frag.appendChild(div);
  });

  if (matches.length === 0 && filterOn && query.length >= 2) {
    const msg = document.createElement('div');
    msg.className   = 'history-filter-empty-msg';
    msg.textContent = '✅ All matches already searched. Disable "Skip searched" to see them.';
    frag.appendChild(msg);
  }

  _el.spedSuggestions.replaceChildren(frag);
}

function selectSuggestion(match: Product): void {
  _el.spedBarcode.value           = String(match.id);
  _el.spedProductName.textContent = match.name ?? '';
  _el.spedSuggestions.replaceChildren();
  copyToClipboard(match.id, _copyToast);
  void nextSped();
}

/* ── Tiny helper ─────────────────────────────────────────────────────────── */

function setText(id: string, value: string): void {
  const el = findEl(id);
  if (el) el.textContent = value;
}
