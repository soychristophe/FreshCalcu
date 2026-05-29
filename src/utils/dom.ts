// ─── src/utils/dom.ts ────────────────────────────────────────────────────────
// Typed DOM utilities — no business logic, no state.

import { HAPTIC_DURATION_MS } from '@/config/constants.ts';

/* ── Element creation ────────────────────────────────────────────────────── */

/**
 * Type-safe element factory.
 * `make('div', { className: 'foo', textContent: 'bar' }, child1, child2)`
 */
export function make<K extends keyof HTMLElementTagNameMap>(
  tag:      K,
  props:    Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  if (children.length) node.append(...(children as [Node | string, ...(Node | string)[]]));
  return node;
}

/* ── Text fitting ────────────────────────────────────────────────────────── */

/**
 * Shrinks the font size of `el` until it fits within its parent,
 * stopping at `minSize`.
 */
export function fitText(
  el:      HTMLElement | null,
  maxSize: number = 35,
  minSize: number = 10,
): void {
  if (!el) return;
  let size = maxSize;
  el.style.fontSize = `${size}px`;
  while (
    size > minSize &&
    (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)
  ) {
    size--;
    el.style.fontSize = `${size}px`;
  }
}

/* ── Haptic feedback ─────────────────────────────────────────────────────── */

export function haptic(): void {
  navigator.vibrate?.(HAPTIC_DURATION_MS);
}

/* ── Toast ───────────────────────────────────────────────────────────────── */

/**
 * Shows the global copy-to-clipboard toast for `ms` milliseconds.
 * The toast element is expected to have id="copy-toast".
 */
export function showToast(toastEl: HTMLElement, ms = 2_000): void {
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ── Error display ───────────────────────────────────────────────────────── */

/** Shows or hides an inline error element. Pass `null`/`undefined` to hide. */
export function setError(errEl: HTMLElement | null, msg?: string | null): void {
  if (!errEl) return;
  errEl.textContent   = msg ?? '';
  errEl.style.display = msg ? 'block' : 'none';
}

/* ── XSS-safe HTML escaping ──────────────────────────────────────────────── */

/** Escapes a string for safe insertion into HTML attribute values or text nodes. */
export function esc(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/* ── DOM element accessor ────────────────────────────────────────────────── */

/**
 * Typed getElementById wrapper.
 * Throws at startup if an element is missing — fast feedback during development.
 */
export function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Required DOM element #${id} not found`);
  return el;
}

/** Like `getEl` but returns `null` instead of throwing (for optional elements). */
export function findEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
