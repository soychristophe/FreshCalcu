// ─── src/components/calculator.ts ────────────────────────────────────────────
// Calculator state mutations and display rendering.

import { OPS }            from '@/config/constants.ts';
import { state, persistCalc } from '@/state/appState.ts';
import { safeEval, round1, round2 } from '@/utils/math.ts';
import { haptic }         from '@/utils/dom.ts';
import type { AppElements } from '@/types/index.ts';

let _el: AppElements;

export function initCalculator(el: AppElements): void {
  _el = el;
}

/* ── Input handlers ──────────────────────────────────────────────────────── */

export function press(v: string): void {
  haptic();

  if (state.inputFocus === 'unit') {
    if (!isNaN(Number(v)) || v === '.') {
      if (v === '.' && state.boxVal.includes('.')) return;
      state.boxVal = state.boxVal === '0' && v !== '.' ? v : state.boxVal + v;
      refresh();
    }
    return;
  }

  if (OPS.has(v)) {
    state.calcVal = OPS.has(state.calcVal.slice(-1))
      ? state.calcVal.slice(0, -1) + v
      : state.calcVal + v;
  } else {
    if (v === '.') {
      const lastNum = state.calcVal.split(/[+\-*/]/).pop() ?? '';
      if (lastNum.includes('.')) return;
    }
    state.calcVal = state.calcVal === '0' && !isNaN(Number(v))
      ? v
      : state.calcVal + v;
  }

  refresh();
}

export function del(): void {
  haptic();
  if (state.inputFocus === 'unit') {
    state.boxVal = state.boxVal.slice(0, -1) || '0';
  } else {
    state.calcVal = state.calcVal.slice(0, -1) || '0';
  }
  refresh();
}

export function cls(): void {
  haptic();
  if (state.inputFocus === 'unit') {
    state.boxVal = '0';
  } else {
    state.calcVal = '0';
  }
  refresh();
}

export function clsTotal(): void {
  haptic();
  state.calcVal    = '0';
  state.boxVal     = '0';
  state.inputFocus = 'calc';
  setInputFocus('calc');
  refresh();
}

/* ── Input focus ─────────────────────────────────────────────────────────── */

export function setInputFocus(target: 'calc' | 'unit'): void {
  haptic();
  state.inputFocus = target;
  document.getElementById('calc-focus-area')?.classList.toggle('focus-active', target === 'calc');
  document.getElementById('unit-focus-area')?.classList.toggle('focus-active', target === 'unit');
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

function evalCalc(): number {
  const result = safeEval(state.calcVal);
  return isNaN(result) ? 0 : round1(result);
}

function renderPreview(result: number): void {
  _el.preview.textContent =
    result && result.toString() !== state.calcVal ? `= ${result}` : '';
}

function renderBoxDisplay(divisor: number): void {
  const total = parseFloat(state.boxVal) || 0;

  if (total > 0 && divisor > 0) {
    const full = Math.floor(total / divisor);
    const rest = round2(total % divisor);
    _el.miniFull.textContent = String(full);
    _el.miniRest.textContent = String(rest);

    let formula = '';
    if (state.calcVal.includes('*')) {
      const first = parseFloat(state.calcVal.split('*')[0] ?? '');
      if (first > 0) {
        const extraBoxes = Math.floor(rest / first);
        const remaining  = round2(rest % first);
        if (extraBoxes > 0 && remaining > 0) {
          formula = `(${first}x${extraBoxes})+${remaining}`;
        } else if (extraBoxes > 0) {
          formula = `(${first}x${extraBoxes})`;
        } else {
          formula = `${remaining}`;
        }
      }
    }
    _el.miniFormula.textContent = formula;
    return;
  }

  _el.miniFull.textContent    = '0';
  _el.miniRest.textContent    = '0';
  _el.miniFormula.textContent = '';
}

export function refresh(): void {
  const result = evalCalc();
  _el.display.textContent  = state.calcVal;
  _el.miniTotal.textContent = state.boxVal || '0';
  renderPreview(result);
  renderBoxDisplay(result);
  persistCalc();
  adjustFontSize();
}

/* ── Font size ───────────────────────────────────────────────────────────── */

export function adjustFontSize(): void {
  requestAnimationFrame(() => {
    const row = _el.display.parentElement;
    if (!row) return;
    if (row.scrollWidth <= row.clientWidth) return;

    let size = parseFloat(getComputedStyle(_el.display).fontSize);
    const minPx = 11;
    while (size > minPx && row.scrollWidth > row.clientWidth) {
      size -= 0.5;
      _el.display.style.fontSize  = `${size}px`;
      _el.preview.style.fontSize  = `${size * 0.82}px`;
    }
  });
}
