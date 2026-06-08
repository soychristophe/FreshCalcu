// ─── src/components/pwa.ts ────────────────────────────────────────────────────
// PWA: install banner + online/offline badge.
//
// El Service Worker lo registra automáticamente vite-plugin-pwa (registerType:
// 'autoUpdate', injectRegister: 'auto') — NO necesitamos llamar a
// navigator.serviceWorker.register() aquí.
//
// Cuando hay una nueva versión del SW disponible, Workbox la activa en el
// background y el usuario la obtiene en el siguiente reload normal.

import { state }  from '@/state/appState.ts';
import type { AppElements } from '@/types/index.ts';

let _el: AppElements;

export function initPwa(el: AppElements): void {
  _el = el;
  initInstallBanner();
  initOnlineStatus();
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
