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
import { initProductsPanel } from '@/components/products-panel/index.ts';

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

/* ── SW asset pre-caching ────────────────────────────────────────────────── */
// After the page has loaded, tell the Service Worker to cache all Vite-hashed
// bundles that were fetched this session. This ensures the NEXT cold start on
// Android serves JS entirely from cache (no blank-screen wait for network).

function precacheViteAssets(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.ready.then(reg => {
    if (!reg.active) return;

    const scriptUrls = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[src]'),
    ).map(s => s.src);

    const styleUrls = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ).map(l => l.href);

    const urls = [...scriptUrls, ...styleUrls].filter(
      u => u.includes('/assets/'),
    );

    if (urls.length > 0) {
      reg.active.postMessage({ type: 'PRECACHE_ASSETS', urls });
    }
  }).catch(() => { /* non-critical */ });
}

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

  // After everything is painted, warm the SW cache with the Vite bundles
  // so the next cold start is instant.
  precacheViteAssets();
});

/* ── Expose only what HTML inline handlers still need ────────────────────────
 *
 * Ideally index.html uses data-attributes + addEventListener exclusively.
 * Until the HTML is fully migrated, these minimal globals bridge the gap.
 * Each one is a direct re-export — no logic lives here.
 *
 * NOTE: Products-panel no longer needs refreshProductCache on window because
 * it imports it directly as an ES module.
 */
Object.assign(window, {
  // Calculator
  press, del, cls, clsTotal, setInputFocus,

  // Navigation
  switchTab,

  // Copy
  copyToClipboard: (text: unknown) => copyToClipboard(text, triggerCopyToast),

  // MSJ
  showMsj, toggleRotation,

  // SPED
  cancelSped,
  nextSped:    () => void nextSped(),
  backSped,
  processSped,
  pasteClipboard: () => void pasteClipboard(),
  resetSped,
  setSpedView,
  backToStep2FromCalcResult,
  backToStep2FromPullResult,
  sendTodayToCalcu,
  sendPullToCalcu,

  // History
  toggleHistoryPanel,
  clearHistory,

  // History All
  toggleHistoryAllPanel: () => void toggleHistoryAllPanel(),
  applyHistoryAllFilter: () => void applyHistoryAllFilter(),
});
