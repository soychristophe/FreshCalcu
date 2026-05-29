// ─── src/components/calculator.ts ────────────────────────────────────────────
// Calculator state mutations and display rendering.

import { OPS }                  from '@/config/constants.ts';
import { state, persistCalc }   from '@/state/appState.ts';
import { safeEval, round1, round2 } from '@/utils/math.ts';
import { haptic }               from '@/utils/dom.ts';
import type { AppElements }     from '@/types/index.ts';
import { renderBoxStack }       from '@/components/boxStack.ts';

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

/* ── Side hints (±1 on the second operand of a multiplication) ───────────── */
//
// Shows two compact lateral panels flanking the main display:
//   Left  → second operand - 1, with the full-crate count that would result
//   Right → second operand + 1, with the full-crate count that would result
//
// Only active when:
//   • calcVal contains exactly one '*' with a plain integer after it (e.g. "9*8")
//   • boxVal holds a positive quantity
//
// IDs expected in HTML:
//   #hint-left-val   #hint-left-crates
//   #hint-right-val  #hint-right-crates

function renderSideHints(): void {
  const leftVal    = document.getElementById('hint-left-val');
  const leftCr     = document.getElementById('hint-left-crates');
  const rightVal   = document.getElementById('hint-right-val');
  const rightCr    = document.getElementById('hint-right-crates');
  const hintLeft   = document.getElementById('hint-left');
  const hintRight  = document.getElementById('hint-right');

  if (!leftVal || !leftCr || !rightVal || !rightCr) return;

  const clear = (): void => {
    leftVal.textContent   = '';
    leftCr.textContent    = '';
    rightVal.textContent  = '';
    rightCr.textContent   = '';
    hintLeft?.setAttribute('data-empty', 'true');
    hintRight?.setAttribute('data-empty', 'true');
  };

  const qty     = parseFloat(state.boxVal) || 0;
  const starIdx = state.calcVal.indexOf('*');

  if (qty <= 0 || starIdx === -1) { clear(); return; }

  const prefix    = state.calcVal.slice(0, starIdx + 1);  // e.g. "9*"
  const secondStr = state.calcVal.slice(starIdx + 1).trim();

  // Only handle a plain positive integer as the second operand
  if (!/^\d+$/.test(secondStr)) { clear(); return; }

  const secondNum = parseInt(secondStr, 10);
  if (secondNum <= 0) { clear(); return; }

  const leftN  = Math.max(1, secondNum - 1);
  const rightN = secondNum + 1;

  const leftDivisor  = safeEval(`${prefix}${leftN}`);
  const rightDivisor = safeEval(`${prefix}${rightN}`);

  if (!isNaN(leftDivisor) && leftDivisor > 0) {
    leftVal.textContent  = String(leftN);
    leftCr.textContent   = `${Math.floor(qty / leftDivisor)} cr`;
    hintLeft?.removeAttribute('data-empty');
  } else {
    leftVal.textContent  = '';
    leftCr.textContent   = '';
    hintLeft?.setAttribute('data-empty', 'true');
  }

  if (!isNaN(rightDivisor) && rightDivisor > 0) {
    rightVal.textContent = String(rightN);
    rightCr.textContent  = `${Math.floor(qty / rightDivisor)} cr`;
    hintRight?.removeAttribute('data-empty');
  } else {
    rightVal.textContent = '';
    rightCr.textContent  = '';
    hintRight?.setAttribute('data-empty', 'true');
  }
}

/* ── Main refresh ────────────────────────────────────────────────────────── */

export function refresh(): void {
  const result = evalCalc();
  _el.display.textContent   = state.calcVal;
  _el.miniTotal.textContent = state.boxVal || '0';
  renderPreview(result);
  renderBoxDisplay(result);
  renderSideHints();
  renderBoxStack();
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
      _el.display.style.fontSize = `${size}px`;
      _el.preview.style.fontSize = `${size * 0.82}px`;
    }
  });
}
