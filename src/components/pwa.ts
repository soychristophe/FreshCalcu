// ─── src/components/pwa.ts ────────────────────────────────────────────────────
// PWA: install banner, online/offline badge, service worker registration.

import { state }  from '@/state/appState.ts';
import type { AppElements } from '@/types/index.ts';

let _el: AppElements;

export function initPwa(el: AppElements): void {
  _el = el;

  registerServiceWorker();
  initInstallBanner();
  initOnlineStatus();
}

/* ── Service Worker ──────────────────────────────────────────────────────── */

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js').catch(() => undefined);

  // When a brand-new SW activates (first install or version upgrade) it posts
  // SW_ACTIVATED. We reload once — but ONLY if the page is not already
  // controlled (i.e. it's a fresh install landing on a half-cached shell).
  // The flag prevents an infinite reload loop.
  const RELOAD_FLAG = 'fw_sw_reloaded';
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'SW_ACTIVATED') return;
    if (navigator.serviceWorker.controller) return; // already controlled — skip
    if (sessionStorage.getItem(RELOAD_FLAG)) return; // already reloaded once
    sessionStorage.setItem(RELOAD_FLAG, '1');
    window.location.reload();
  });
}

/* ── Install banner ──────────────────────────────────────────────────────── */

function initInstallBanner(): void {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.deferredPrompt = e;
    _el.installBanner.classList.add('visible');
  });

  _el.installBtn.addEventListener('click', async () => {
    if (!state.deferredPrompt) return;
    const prompt = state.deferredPrompt;
    hideBanner();
    await prompt.prompt();
    await prompt.userChoice;
  });

  _el.dismissBtn.addEventListener('click', hideBanner);
  window.addEventListener('appinstalled', hideBanner);
}

function hideBanner(): void {
  _el.installBanner.classList.remove('visible');
  state.deferredPrompt = null;
}

/* ── Online / Offline badge ──────────────────────────────────────────────── */

function initOnlineStatus(): void {
  const update = (): void => {
    _el.offlineBadge.classList.toggle('visible', !navigator.onLine);
  };
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}
