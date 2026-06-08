// ─── CSS (Vite bundles and hashes these automatically) ─────────────────────
import '@/styles/base.css';
import '@/styles/layout.css';
import '@/styles/pwa.css';
import '@/styles/calculator.css';
import '@/styles/keyboard.css';
import '@/styles/msj.css';
import '@/styles/speed.css';
import '@/styles/history.css';
import '@/styles/products-panel.css';
import '@/styles/intelligence.css';

// ─── src/main.ts ──────────────────────────────────────────────────────────────
// Application entry point.
// Wires together all components. No business logic here — only orchestration.

import { state }             from '@/state/appState.ts';
import { getEl, showToast }  from '@/utils/dom.ts';
import { copyToClipboard }   from '@/utils/clipboard.ts';

import { initPwa }           from '@/components/pwa.ts';
import { initCalculator, refresh, adjustFontSize, press, del, cls, clsTotal, setInputFocus }
                             from '@/components/calculator.ts';
import { initBoxStack }      from '@/components/boxStack.ts';
import { initMsj, showMsj, toggleRotation }
                             from '@/components/msj.ts';
import { initNavigation, switchTab }
                             from '@/components/navigation.ts';
import {
  initSped,
  setSpedView,
  cancelSped,
  nextSped,
  backSped,
  processSped,
  resetSped,
  pasteClipboard,
  backToStep2FromCalcResult,
  backToStep2FromPullResult,
  sendTodayToCalcu,
  sendPullToCalcu,
}                            from '@/components/sped/index.ts';
import {
  initHistoryPanel,
  toggleHistoryPanel,
  clearHistory,
  renderHistoryList,
  updateHistoryFilterCount,
}                            from '@/components/history/panel.ts';
import {
  toggleHistoryAllPanel,
  applyHistoryAllFilter,
}                            from '@/components/history/historyAll.ts';
import { initProductsPanel } from '@/components/products-panel/products-panel.index.ts';
import { initIntelligence }  from '@/components/intelligence/intelligence.ts';

import { loadProductCache }  from '@/services/productCache.ts';
import { syncHistoryFromDB } from '@/services/historyService.ts';
import type { AppElements }  from '@/types/index.ts';

/* ── Build the DOM element cache ─────────────────────────────────────────── */

const el: AppElements = {
  display:         getEl('display'),
  preview:         getEl('preview'),
  screen:          getEl('screen-header'),
  miniTotal:       getEl('mini-total'),
  miniFull:        getEl('mini-full'),
  miniRest:        getEl('mini-rest'),
  miniFormula:     getEl('mini-formula'),
  offlineBadge:    getEl('offline-badge'),
  copyToast:       getEl('copy-toast'),
  installBanner:   getEl('install-banner'),
  installBtn:      getEl<HTMLButtonElement>('install-btn'),
  dismissBtn:      getEl<HTMLButtonElement>('dismiss-btn'),
  overlay:         getEl('msj-overlay'),
  msjText:         getEl('msj-text'),
  spedBarcode:     getEl<HTMLInputElement>('sped-barcode'),
  spedQty:         getEl<HTMLInputElement>('sped-qty'),
  pullQty:         getEl<HTMLInputElement>('pull-qty'),
  spedSuggestions: getEl('sped-suggestions'),
  spedProductName: getEl('sped-product-name'),
  spedProductInfo: getEl('sped-product-info'),
  spedError1:      getEl('sped-error-step1'),
  spedError2:      getEl('sped-error-step2'),
  spedStep1:       getEl('sped-step1'),
  spedStep2:       getEl('sped-step2'),
  spedCalcResult:  getEl('sped-calc-result'),
  spedPullResult:  getEl('sped-pull-result'),
  secMain:         getEl('sec-main'),
  secMsj:          getEl('sec-msj'),
  secSped:         getEl('sec-sped'),
};

/* ── Toast wrapper (bound to the real DOM element) ───────────────────────── */

const triggerCopyToast = (): void => showToast(el.copyToast);


/* ── Bootstrap ───────────────────────────────────────────────────────────── */

window.addEventListener('DOMContentLoaded', () => {
  // Core components
  initPwa(el);
  initCalculator(el);
  initBoxStack();
  initMsj(el);
  initHistoryPanel(el);

  // SPED
  initSped(el, triggerCopyToast);

  // Navigation wired last (depends on all others being ready)
  initNavigation({
    el,
    press,
    del,
    cls,
    adjustFont:  adjustFontSize,
    setSpedView: (v: string) => setSpedView(v as Parameters<typeof setSpedView>[0]),
  });

  // Products panel (self-injecting)
  initProductsPanel();
  initIntelligence();

  // Initial render
  el.display.textContent = state.calcVal;
  refresh();
  setInputFocus('calc');

  // ── History: render immediately from localStorage, then refresh from D1 ──
  // Showing stale-but-instant local data avoids the blank history panel on
  // Android cold start while the Cloudflare Worker wakes up (can take 2-5s).
  renderHistoryList();
  updateHistoryFilterCount();

  void syncHistoryFromDB().then(() => {
    renderHistoryList();
    updateHistoryFilterCount();
  });

  // Product cache: hydrates from localStorage synchronously inside loadProductCache,
  // then refreshes from network in the background.
  void loadProductCache();

  // El Service Worker (Workbox via vite-plugin-pwa) ya precachea todos los
  // assets en build time — no necesitamos hacer nada aquí.
});

/* ── Wire all HTML inline handlers via data-action delegation ────────────────
 *
 * El HTML usa data-action="fnName" (y data-arg="value" cuando corresponde)
 * en lugar de onclick="fnName()". Un único listener en <body> despacha a la
 * función correcta sin exponer nada en window.
 *
 * Formato en el HTML:
 *   <button data-action="press" data-arg="+">+</button>
 *   <button data-action="cls">Clean</button>
 *   <span   data-action="copyToClipboard" data-arg-inner>0</span>   ← usa innerText como arg
 */

type ActionArg = string | undefined;

const ACTION_MAP: Record<string, (arg: ActionArg, target: Element) => void> = {
  // Calculator
  press:          (arg) => { if (arg) press(arg); },
  del:            ()    => del(),
  cls:            ()    => cls(),
  clsTotal:       ()    => clsTotal(),
  setInputFocusCalc: () => setInputFocus('calc'),
  setInputFocusUnit: () => setInputFocus('unit'),
  copyToClipboard:(_, t) => copyToClipboard((t as HTMLElement).innerText, triggerCopyToast),

  // Navigation
  switchTab:      (arg) => { if (arg) switchTab(arg as Parameters<typeof switchTab>[0]); },

  // MSJ
  showMsj:        (arg) => {
    if (!arg) return;
    const parts = JSON.parse(arg) as [string, string, string, string?];
    const [text, bg, color, border] = parts;
    showMsj(text, bg, color, border);
  },
  toggleRotation: (_, t) => toggleRotation({ target: t } as unknown as MouseEvent),

  // SPED
  cancelSped:                  ()  => cancelSped(),
  nextSped:                    ()  => void nextSped(),
  backSped:                    ()  => backSped(),
  processSped:                 ()  => processSped(),
  pasteClipboard:              ()  => void pasteClipboard(),
  resetSped:                   ()  => resetSped(),
  setSpedView:                 (arg) => { if (arg) setSpedView(arg as Parameters<typeof setSpedView>[0]); },
  backToStep2FromCalcResult:   ()  => backToStep2FromCalcResult(),
  backToStep2FromPullResult:   ()  => backToStep2FromPullResult(),
  sendTodayToCalcu:            ()  => sendTodayToCalcu(),
  sendPullToCalcu:             ()  => sendPullToCalcu(),

  // History
  toggleHistoryPanel:          ()  => toggleHistoryPanel(),
  clearHistory:                ()  => clearHistory(),
  toggleHistoryAllPanel:       ()  => void toggleHistoryAllPanel(),
  applyHistoryAllFilter:       ()  => void applyHistoryAllFilter(),
};

document.body.addEventListener('click', (e: MouseEvent) => {
  const target = (e.target as Element).closest<HTMLElement>('[data-action]');
  if (!target) return;

  const action = target.dataset['action'];
  if (!action) return;

  const handler = ACTION_MAP[action];
  if (!handler) {
    console.warn(`[freshways] Unknown data-action: "${action}"`);
    return;
  }

  handler(target.dataset['arg'], target);
});
