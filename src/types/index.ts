// ─── src/types/index.ts ───────────────────────────────────────────────────────
// Central type registry — import from here everywhere.
// No runtime code; only interfaces, types, and enums.

/* ── Domain models ────────────────────────────────────────────────────────── */

/** A product record as returned by the D1 Worker API. */
export interface Product {
  readonly id:     string;
  readonly name:   string;
  readonly sku?:   string;
  readonly values: readonly string[];   // formula strings e.g. ["9*6", "9*7"]
}

/** Shape the API returns for paginated product lists. */
export interface ProductPage {
  readonly products: Product[];
  readonly page:     number;
  readonly pages:    number;
  readonly total:    number;
}

/** A single entry in the scan history (local + D1). */
export interface HistoryEntry {
  /** D1 row id — undefined when the entry is local-only (offline). */
  readonly rowId?:   number;
  readonly id:       string;   // barcode / product ID
  readonly name:     string;
  readonly time:     string;   // formatted local time string
  /** CC Qty processed — set after processSped() completes. */
  readonly qty?:     number | null;
  /** Pull Forward Qty — set after processSped() completes. */
  readonly pullQty?: number | null;
}

/** Shape returned by GET /api/history */
export interface RemoteHistoryEntry {
  readonly rowId:    number;
  readonly id:       string;
  readonly name:     string;
  readonly time:     string;
  readonly qty:      number | null;
  readonly pull_qty: number | null;
}

/** A single entry in history-all with its row id (for individual delete). */
export interface HistoryAllEntry {
  readonly id:           number;   // row id — used for individual delete
  readonly barcode_id:   string;
  readonly product_name: string;
  readonly scanned_at:   string;
  readonly qty:          number | null;
  readonly pull_qty:     number | null;
}

/** HistoryAllEntry is defined above alongside RemoteHistoryEntry. */

/** Shape returned by GET /api/history-all */
export interface HistoryAllPage {
  readonly entries: HistoryAllEntry[];
  readonly total:   number;
}

/* ── App state ────────────────────────────────────────────────────────────── */

export type TabMode       = 'calc' | 'box' | 'msj' | 'sped';
export type InputFocus    = 'calc' | 'unit';
export type SpedView      = 'step1' | 'step2' | 'calc-result' | 'pull-result';

/** Result of a single SPED formula calculation. */
export interface SpedCalc {
  readonly product:    Product;
  readonly totalUnits: number;
  readonly formula:    string;
  readonly divisor:    number;
  readonly full:       number;
  readonly rem:        number;
}

/** The pull-forward subset (no product reference needed). */
export interface SpedPullCalc {
  readonly formula:    string;
  readonly totalUnits: number;
  readonly full:       number;
  readonly rem:        number;
}

/** Central application state.  Mutated in-place via setters in appState.ts. */
export interface AppState {
  mode:             TabMode;
  inputFocus:       InputFocus;
  calcVal:          string;
  boxVal:           string;
  selectedProduct:  Product | null;
  msjAngle:         number;
  deferredPrompt:   BeforeInstallPromptEvent | null;
  spedOriginalCalc: SpedCalc | null;
  spedPullCalc:     SpedPullCalc | null;
  spedCurrentView:  SpedView;
}

/* ── API client options ─────────────────────────────────────────────────── */

export interface SearchOptions {
  limit?:   number;
  exclude?: string[];
}

export interface HistoryAllOptions {
  from?:  string;
  to?:    string;
  page?:  number;
  limit?: number;
}

/* ── PWA ────────────────────────────────────────────────────────────────── */

/**
 * The BeforeInstallPromptEvent is not yet in the standard lib.d.ts.
 * We declare it here so TypeScript is aware of it.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled:        Event;
  }
}

/* ── DOM element cache ──────────────────────────────────────────────────── */

/**
 * All DOM elements cached at startup.
 * Each field is guaranteed non-null after initElements() runs —
 * if any element is missing the app throws early with a clear message.
 */
export interface AppElements {
  display:         HTMLElement;
  preview:         HTMLElement;
  screen:          HTMLElement;
  miniTotal:       HTMLElement;
  miniFull:        HTMLElement;
  miniRest:        HTMLElement;
  miniFormula:     HTMLElement;
  offlineBadge:    HTMLElement;
  copyToast:       HTMLElement;
  installBanner:   HTMLElement;
  installBtn:      HTMLButtonElement;
  dismissBtn:      HTMLButtonElement;
  overlay:         HTMLElement;
  msjText:         HTMLElement;
  spedBarcode:     HTMLInputElement;
  spedQty:         HTMLInputElement;
  pullQty:         HTMLInputElement;
  spedSuggestions: HTMLElement;
  spedProductName: HTMLElement;
  spedProductInfo: HTMLElement;
  spedError1:      HTMLElement;
  spedError2:      HTMLElement;
  spedStep1:       HTMLElement;
  spedStep2:       HTMLElement;
  spedCalcResult:  HTMLElement;
  spedPullResult:  HTMLElement;
  /** Optional: injected by barcode-scanner component when camera scan is enabled. */
  spedScanBtn?:    HTMLButtonElement;
  secMain:         HTMLElement;
  secMsj:          HTMLElement;
  secSped:         HTMLElement;
}

/* ── Tab config ─────────────────────────────────────────────────────────── */

export interface TabConfig {
  readonly sectionKey: keyof Pick<AppElements, 'secMain' | 'secMsj' | 'secSped'>;
  readonly display:    string;
}

/* ── Custom events ───────────────────────────────────────────────────────── */

/**
 * Fired by history panel and products panel when they close,
 * so SPED can return focus to #sped-barcode if appropriate.
 */
declare global {
  interface DocumentEventMap {
    'modal:closed':  CustomEvent;
    'sped:prefill':  CustomEvent<SpedPrefillDetail>;
  }
}

export interface SpedPrefillDetail {
  /** Product ID / barcode to pre-fill. */
  productId: string;
}
