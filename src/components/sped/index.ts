// ─── src/components/sped/index.ts ────────────────────────────────────────────
// SPED tab orchestrator — wires together search, step navigation,
// formula calculation, and result display.
//
// Changes vs previous version:
//   • Voice / microphone removed entirely (qty field and barcode area)
//   • Session shift UI (Start/End shift buttons) removed
//   • "Total to process" standalone row removed — total input is now inline
//     in the filter row, visible only when "Skip searched" is ON
//   • History Day entries now store CC Qty and Pull Qty via updateHistoryWithQty
//   • Scan button wired with iOS-compatible fallback scanner
//   • _suppressAutofill() eliminates Chrome Android autofill popups
//     (passwords, credit cards, location) via readonly-on-init trick
import { state }                     from '@/state/appState.ts';
import { findProduct }                from '@/services/productCache.ts';
import { apiAddHistoryAll }           from '@/services/api.ts';
import {
  addToHistory,
  getHistory,
  updateHistoryWithQty,
}                                     from '@/services/historyService.ts';
import {
  renderHistoryList,
  updateHistoryFilterCount,
  updateSpedProgressCounter,
  isFilterHistoryOn,
}                                     from '@/components/history/panel.ts';
import {
  refresh as calcRefresh,
}                                     from '@/components/calculator.ts';
import { switchTab }                  from '@/components/navigation.ts';
import {
  safeEval,
  pickBestFormula,
  computeCrateCalc,
  getRemainderFormula,
}                                     from '@/utils/math.ts';
import { copyToClipboard }            from '@/utils/clipboard.ts';
import { pasteFromClipboard }         from '@/utils/clipboard.ts';
import { haptic, make, fitText, setError, findEl } from '@/utils/dom.ts';
import { SEARCH_DEBOUNCE_MS }         from '@/config/constants.ts';
import {
  addSessionEntry,
}                                     from '@/services/sessionService.ts';
import type { AppElements, Product, SpedView } from '@/types/index.ts';

let _el: AppElements;
let _copyToast: () => void;

/* ── Init ────────────────────────────────────────────────────────────────── */
export function initSped(el: AppElements, showCopyToast: () => void): void {
  _el         = el;
  _copyToast  = showCopyToast;

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
    updateSpedProgressCounter();
    _el.spedBarcode.dispatchEvent(new Event('input'));
  });

  // ── Focus lock ────────────────────────────────────────────────────────────
  document.addEventListener('keydown', _focusLockHandler, true);
  document.addEventListener('modal:closed', () => {
    requestAnimationFrame(() => _maybeReturnFocus());
  });

  // ── History Day prefill ───────────────────────────────────────────────────
  document.addEventListener('sped:prefill', (e: CustomEvent<{ productId: string }>) => {
    void _handlePrefill(e.detail.productId);
  });

  // ── Camera scan button ────────────────────────────────────────────────────
  _initScanButton();

  // ── Suprimir autofill de Chrome Android (contraseñas, tarjetas, ubicación) ─
  // NOTA: Si tienes un main.ts / app init global, mueve esta llamada allí
  // para que cubra también inputs que se monten fuera de este componente.
  _suppressAutofill();

  // Initial render
  updateSpedProgressCounter();
}

/* ── Suppress Chrome Android autofill popups ─────────────────────────────── */
/**
 * Elimina el panel de sugerencias de Chrome Android (contraseñas, tarjetas
 * bancarias, ubicación) en todos los inputs del documento.
 *
 * MECANISMO:
 *   Chrome no muestra el autofill bottom-sheet en campos con `readonly`.
 *   Los inputs vienen del HTML con readonly ya puesto. Aquí registramos
 *   el listener que lo elimina en el momento del focus, justo antes de que
 *   el usuario empiece a escribir, sin afectar a la UX.
 *
 *   También forzamos autocomplete="off" por si algún input se crea
 *   dinámicamente sin ese atributo.
 *
 * EXCEPCIONES:
 *   - type="checkbox" / "radio" / "hidden" → no necesitan protección.
 *   - type="date" → readonly bloquearía el date-picker nativo; se omite.
 */
function _suppressAutofill(): void {
  const safeSelector =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="date"])';

  document
    .querySelectorAll<HTMLInputElement>(safeSelector)
    .forEach(input => {
      // Garantizar atributos anti-autofill en caso de inputs inyectados sin ellos
      if (!input.getAttribute('autocomplete'))   input.setAttribute('autocomplete',   'off');
      if (!input.getAttribute('data-lpignore'))  input.setAttribute('data-lpignore',  'true'); // LastPass
      if (!input.getAttribute('data-1p-ignore')) input.setAttribute('data-1p-ignore', 'true'); // 1Password
      if (!input.getAttribute('data-form-type')) input.setAttribute('data-form-type', 'other'); // Dashlane / Chrome

      // Al recibir el foco, desactivar readonly para permitir escritura.
      // Chrome no puede indexar el campo antes de que el usuario lo toque,
      // por lo que nunca llega a mostrar el panel de autofill.
      input.addEventListener('focus', () => {
        input.removeAttribute('readonly');
      }, { passive: true });
    });
}

/* ── Focus lock helpers ──────────────────────────────────────────────────── */
function _isModalOpen(): boolean {
  if (findEl('history-panel')?.classList.contains('open')) return true;
  const ppOverlay = findEl('products-panel-overlay');
  if (ppOverlay?.classList.contains('open')) return true;
  if (findEl('history-all-panel')?.classList.contains('open')) return true;
  if (_el.overlay.classList.contains('active')) return true;
  return false;
}

function _focusLockHandler(e: KeyboardEvent): void {
  if (state.mode !== 'sped' || state.spedCurrentView !== 'step1') return;
  if (_isModalOpen()) return;
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Backspace') return;
  _el.spedBarcode.focus();
}

function _maybeReturnFocus(): void {
  if (state.mode !== 'sped') return;
  if (state.spedCurrentView !== 'step1') return;
  if (_isModalOpen()) return;
  _el.spedBarcode.focus();
}

export function returnFocusToBarcode(): void {
  _maybeReturnFocus();
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
    if (/^\d{10,15}$/.test(barcode)) {
      addToHistory({ id: barcode, name: 'Product not found', values: [] });
      renderHistoryList();
      updateHistoryFilterCount();
      updateSpedProgressCounter();
    }
    return;
  }

  // Clear qty fields if switching to a different product
  const previousId = state.selectedProduct?.id;
  if (!previousId || String(previousId) !== String(product.id)) {
    (_el.spedQty as HTMLInputElement).value = '';
    if (_el.pullQty) (_el.pullQty as HTMLInputElement).value = '';
  }

  state.selectedProduct = product;
  addToHistory(product);
  renderHistoryList();
  updateHistoryFilterCount();
  updateSpedProgressCounter();
  setSpedView('step2');
  _el.spedQty.focus();
  renderSpedProductInfo();
}

/* ── History Day pre-fill ────────────────────────────────────────────────── */
async function _handlePrefill(productId: string): Promise<void> {
  if (state.mode !== 'sped') switchTab('sped');
  const product = await findProduct(productId);
  if (product) {
    state.selectedProduct = product;
    _el.spedBarcode.value = String(product.id);
    renderSpedProductInfo();
    setSpedView('step2');
    (_el.spedQty as HTMLInputElement).value = '';
    if (_el.pullQty) (_el.pullQty as HTMLInputElement).value = '';
    setError(_el.spedError2);
    requestAnimationFrame(() => _el.spedQty.focus());
  } else {
    _el.spedBarcode.value = productId;
    setSpedView('step1');
    requestAnimationFrame(() => {
      _el.spedBarcode.focus();
      _el.spedBarcode.dispatchEvent(new Event('input'));
    });
  }
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
  const pullQtyFinal = (!isNaN(pullQtyVal) && pullQtyVal > 0) ? pullQtyVal : null;

  // ── Update History Day with qty values ───────────────────────────────────
  updateHistoryWithQty(String(state.selectedProduct.id), qty, pullQtyFinal);
  renderHistoryList();

  // Record in active session
  addSessionEntry({
    productId:   String(state.selectedProduct.id),
    productName: state.selectedProduct.name ?? '',
    qty,
    pullQty:     pullQtyFinal,
    formulaUsed: best,
    timestamp:   new Date().toISOString(),
  });

  if (pullQtyFinal !== null) {
    renderPullResult(qty, best, calc, pullQtyFinal);
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
  // No pull qty in this path — clear any stale pull calc from a previous
  // operation so sendPullToCalcu() cannot dispatch outdated values.
  state.spedPullCalc = null;

  const product = state.selectedProduct!;
  const remFormula = getRemainderFormula(best, calc.rem);
  setText('calc-rem-formula',    remFormula ? `${remFormula}` : '');
  setText('calc-product-name',   product.name || product.id);
  setText('calc-header-barcode', String(product.id));
  setText('calc-formula',        `${best} = ${safeEval(best)}`);
  setText('calc-total-units',    String(qty));
  setText('calc-full',           String(calc.full));
  setText('calc-rem',            String(calc.rem));
  fitText(findEl('calc-formula'), 30, 12);
  applySubCrateMode('calc', calc.full === 0);
  setSpedView('calc-result');
  requestAnimationFrame(wireCopyableBarcodes);

  if (navigator.onLine) {
    apiAddHistoryAll(String(product.id), product.name ?? '', qty, null).catch(() => undefined);
  }
}

/* ── Pull result view ────────────────────────────────────────────────────── */
function renderPullResult(
  qty:         number,
  best:        string,
  calc:        { divisor: number; full: number; rem: number },
  pullQtyVal:  number,
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
  setText('pull-today-header-barcode', String(product.id));
  setText('pull-today-formula',     `${best} = ${safeEval(best)}`);
  setText('pull-today-units',       String(qty));
  setText('pull-today-full',        String(calc.full));
  setText('pull-today-rem',         String(calc.rem));
  setText('pull-pull-product',      product.name || product.id);
  setText('pull-pull-header-barcode', String(product.id));
  setText('pull-pull-formula',      `${pullFormula} = ${safeEval(pullFormula)}`);
  setText('pull-pull-units',        String(pullQtyVal));
  setText('pull-pull-full',         String(pullCalc.full));
  setText('pull-pull-rem',          String(pullCalc.rem));

  fitText(findEl('pull-today-formula'), 28, 12);
  fitText(findEl('pull-pull-formula'),  28, 12);
  applySubCrateMode('today', calc.full === 0);
  applySubCrateMode('pull',  pullCalc.full === 0);
  setSpedView('pull-result');
  requestAnimationFrame(wireCopyableBarcodes);

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

  let matches: Product[] = [];
  try {
    const { searchProducts } = await import('@/services/productCache.ts');
    matches = await searchProducts(query, { exclude: historyIds });
  } catch {
    matches = [];
  }

  if (_el.spedBarcode.value.trim() !== query) return;

  if (matches.length === 1) {
    const only = matches[0];
    if (only) selectSuggestion(only);
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

/* ── Camera scan button (iOS-safe) ───────────────────────────────────────── */
/**
 * Wires #sped-scan-btn to the camera scanner.
 * On devices with BarcodeDetector (Chrome/Android) → uses the native API.
 * On iOS/Safari (no BarcodeDetector) → opens a file input with camera capture,
 * then decodes the image with the ZXing multi-format reader.
 *
 * DEPENDENCY NOTE: iOS fallback requires `@zxing/browser` in node_modules.
 * Install with: npm install @zxing/browser
 */
function _initScanButton(): void {
  const btn = findEl<HTMLButtonElement>('sped-scan-btn');
  if (!btn) return;

  if (typeof window.BarcodeDetector !== 'undefined') {
    // ── Native path (Chrome / Android) ───────────────────────────────────
    _initNativeScanner(btn);
  } else {
    // ── iOS / Safari fallback ─────────────────────────────────────────────
    _initIOSScanner(btn);
  }
}

/* Native BarcodeDetector scanner (modal overlay) */
let _scannerOverlay: HTMLElement | null = null;
let _scannerActive  = false;

function _initNativeScanner(btn: HTMLButtonElement): void {
  btn.addEventListener('click', () => {
    if (_scannerActive) { _closeNativeScanner(); return; }
    void _openNativeScanner();
  });
}

async function _openNativeScanner(): Promise<void> {
  _scannerActive = true;
  const overlay = document.createElement('div');
  overlay.id          = 'scan-overlay';
  overlay.style.cssText = `position:fixed;inset:0;z-index:9999; background:#000;display:flex;flex-direction:column; align-items:center;justify-content:center;gap:12px;`;

  const viewport = document.createElement('div');
  viewport.style.cssText = 'width:100%;max-width:480px;height:300px;border-radius:12px;overflow:hidden;position:relative;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = 'color:#fff;background:rgba(255,255,255,.15);border:none;border-radius:8px;padding:8px 20px;font-size:.9rem;cursor:pointer;';
  closeBtn.addEventListener('click', () => _closeNativeScanner());

  overlay.append(viewport, closeBtn);
  document.body.appendChild(overlay);
  _scannerOverlay = overlay;

  try {
    const { startScanner, stopScanner } = await import('./barcode-scanner.ts');
    await startScanner(viewport, rawValue => {
      stopScanner(viewport);
      _closeNativeScanner();
      // ── Insertar en el cajón de búsqueda y hacer foco ─────────────────
      _el.spedBarcode.value = rawValue;
      _el.spedBarcode.focus();
      copyToClipboard(rawValue, _copyToast);
      // Pequeño delay para que el usuario vea el valor antes de avanzar
      setTimeout(() => void nextSped(), 120);
    });
  } catch (err) {
    console.error('Scanner error:', err);
    _closeNativeScanner();
    alert('Camera not available. Please type or paste the barcode manually.');
  }
}

function _closeNativeScanner(): void {
  _scannerActive = false;
  _scannerOverlay?.remove();
  _scannerOverlay = null;
  import('./barcode-scanner.ts').then(({ stopScanner }) => stopScanner()).catch(() => undefined);
}

/* iOS / Safari camera fallback using file input + ZXing */
function _initIOSScanner(btn: HTMLButtonElement): void {
  // Hidden file input that triggers the iOS camera
  const fileInput = document.createElement('input');
  fileInput.type    = 'file';
  fileInput.accept  = 'image/*';
  fileInput.setAttribute('capture', 'environment');
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  btn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // reset so same file can be re-selected
    if (!file) return;

    btn.disabled    = true;
    btn.textContent = '⏳';

    try {
      const rawValue = await _decodeImageWithZXing(file);
      if (rawValue) {
        // ── Insertar en el cajón de búsqueda y hacer foco ───────────────
        _el.spedBarcode.value = rawValue;
        _el.spedBarcode.focus();
        copyToClipboard(rawValue, _copyToast);
        setTimeout(() => void nextSped(), 120);
      } else {
        alert('No barcode detected. Try again with better lighting or a closer shot.');
      }
    } catch (err) {
      console.error('ZXing decode error:', err);
      alert('Could not decode. Make sure @zxing/browser is installed (npm install @zxing/browser).');
    } finally {
      btn.disabled    = false;
      btn.innerHTML    = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
            viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <span class="scan-btn-label">SCAN</span>
      `;
    }
  });
}

/**
 * Decodes a barcode from an image File using @zxing/browser.
 * Dynamically imported so it doesn't bloat the main bundle on Android/Chrome.
 */
async function _decodeImageWithZXing(file: File): Promise<string | null> {
  // Dynamic import — tree-shaken away on browsers that never reach this path.
  const { BrowserMultiFormatReader } = await import('@zxing/browser');

  const img = await createImageBitmap(file);
  const canvas  = document.createElement('canvas');
  canvas.width  = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = new (BrowserMultiFormatReader as any)();

  try {
    // decodeFromCanvas is available in @zxing/browser ≥ 0.1.x
    const result = await (reader as any).decodeFromCanvas(canvas);
    return result?.getText() ?? null;
  } catch {
    return null;
  }
}

/* ── Tiny helper ─────────────────────────────────────────────────────────── */
function setText(id: string, value: string): void {
  const el = findEl(id);
  if (el) el.textContent = value;
}

/** Wire all .barcode-copyable spans so tapping copies the text content. */
function wireCopyableBarcodes(): void {
  document.querySelectorAll<HTMLElement>('.barcode-copyable').forEach(el => {
    if (el.dataset['copyWired']) return; // avoid double-wiring
    el.dataset['copyWired'] = '1';
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const text = el.textContent?.trim() ?? '';
      if (!text) return;
      copyToClipboard(text, _copyToast);
    });
  });
}
