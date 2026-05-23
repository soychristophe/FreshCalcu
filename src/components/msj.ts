// ─── src/components/msj.ts ────────────────────────────────────────────────────
// Message overlay (MSJ tab) — fullscreen, rotatable text display.

import { state }  from '@/state/appState.ts';
import type { AppElements } from '@/types/index.ts';

let _el: AppElements;

export function initMsj(el: AppElements): void {
  _el = el;

  _el.overlay.addEventListener('keydown', handleOverlayKeydown);
  window.addEventListener('resize', () => {
    if (_el.overlay.classList.contains('active')) resizeText();
  });
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export function showMsj(
  text:   string,
  bg:     string,
  color:  string,
  border: string = 'none',
): void {
  _el.overlay.style.cssText = `background:${bg};color:${color};border:${border};`;
  _el.msjText.textContent   = text;
  _el.overlay.classList.add('active');
  _el.overlay.onclick = closeMsj;
  document.documentElement.requestFullscreen?.().catch(() => undefined);
  applyRotation();
}

export function closeMsj(): void {
  _el.overlay.classList.remove('active');
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => undefined);
  }
}

export function toggleRotation(e?: Event): void {
  e?.stopPropagation();
  state.msjAngle -= 90;
  applyRotation();
}

/* ── Private ─────────────────────────────────────────────────────────────── */

function resizeText(): void {
  const maxPx = Math.max(window.innerWidth, window.innerHeight) * 1.5;
  let lo = 10;
  let hi = Math.floor(maxPx);

  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    _el.msjText.style.fontSize = `${mid}px`;
    void _el.msjText.offsetHeight; // force reflow
    const fits =
      _el.msjText.scrollHeight <= _el.msjText.clientHeight &&
      _el.msjText.scrollWidth  <= _el.msjText.clientWidth;
    if (fits) lo = mid; else hi = mid - 1;
  }
  _el.msjText.style.fontSize = `${lo}px`;
}

function applyRotation(): void {
  const isVertical = (Math.abs(state.msjAngle) / 90) % 2 !== 0;
  _el.msjText.style.setProperty('--angle', `${state.msjAngle}deg`);
  _el.msjText.style.setProperty('--tw', isVertical ? '100vh' : '100vw');
  _el.msjText.style.setProperty('--th', isVertical ? '100vw' : '100vh');
  resizeText();
}

function handleOverlayKeydown(e: KeyboardEvent): void {
  if (/^F\d+$/.test(e.key)) e.preventDefault();
  if (e.key === 'Escape') { closeMsj(); return; }
  if (/^[0-9]$/.test(e.key)) {
    _el.msjText.textContent += _el.msjText.textContent?.includes(':')
      ? e.key
      : `: ${e.key}`;
    resizeText();
  }
  if (e.key === 'Backspace') {
    _el.msjText.textContent = (_el.msjText.textContent ?? '').slice(0, -1);
    resizeText();
  }
}
