// ─── src/components/navigation.ts ────────────────────────────────────────────
// Tab switching and global keyboard routing.
// Depends on: state, el (passed in), DOM helpers.

import { TAB_CONFIG, FKEY_TABS, FKEY_OPS, OPS } from '@/config/constants.ts';
import { state }  from '@/state/appState.ts';
import { haptic } from '@/utils/dom.ts';
import { setInputFocus } from '@/components/calculator.ts';
import type { AppElements, TabMode } from '@/types/index.ts';

/* These are set by initNavigation and used by switchTab */
let _el:            AppElements;
let _press:         (v: string) => void;
let _del:           () => void;
let _cls:           () => void;
let _adjustFont:    () => void;
let _setSpedView:   (v: string) => void;

/* ── Public init ─────────────────────────────────────────────────────────── */

interface NavDeps {
  el:          AppElements;
  press:       (v: string) => void;
  del:         () => void;
  cls:         () => void;
  adjustFont:  () => void;
  setSpedView: (v: string) => void;
}

export function initNavigation(deps: NavDeps): void {
  _el          = deps.el;
  _press       = deps.press;
  _del         = deps.del;
  _cls         = deps.cls;
  _adjustFont  = deps.adjustFont;
  _setSpedView = deps.setSpedView;

  window.addEventListener('keydown', handleKeydown);
}

/* ── Tab switching ───────────────────────────────────────────────────────── */

const ALL_SECTION_KEYS = [
  ...new Set(Object.values(TAB_CONFIG).map(c => c.sectionKey)),
] as const;

export function switchTab(t: TabMode): void {
  haptic();
  const cfg = TAB_CONFIG[t];
  if (!cfg) return;

  state.mode = t;

  document.querySelectorAll<HTMLButtonElement>('.top-nav button').forEach(b =>
    b.classList.remove('active'),
  );
  document.getElementById(`tab-${t}`)?.classList.add('active');

  ALL_SECTION_KEYS.forEach(key => {
    (_el[key] as HTMLElement).style.display = 'none';
  });
  (_el[cfg.sectionKey] as HTMLElement).style.display = cfg.display;

  _el.screen.classList.toggle('box-active', t === 'box');

  _el.display.textContent = t === 'box' ? state.boxVal : state.calcVal;
  _adjustFont();

  if (t === 'sped') _setSpedView(state.spedCurrentView);
}

/* ── Keyboard handler ────────────────────────────────────────────────────── */

function handleKeydown(e: KeyboardEvent): void {
  const { key } = e;

  // Don't intercept keys when MSJ overlay is active
  if (_el.overlay.classList.contains('active')) return;

  // Tab navigation via F-keys
  const tabTarget = FKEY_TABS[key];
  if (tabTarget !== undefined) {
    e.preventDefault();
    switchTab(tabTarget);
    return;
  }

  // Don't intercept input/textarea focus
  const tag = (document.activeElement as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  // Operator F-keys
  const opTarget = FKEY_OPS[key];
  if (opTarget !== undefined) {
    e.preventDefault();
    _press(opTarget);
    return;
  }

  if (!isNaN(Number(key)) || key === '.') { _press(key);                        return; }
  if (OPS.has(key))                        { _press(key);                        return; }
  if (key === 'Backspace' || key === 'Delete') { e.preventDefault(); _del();    return; }
  if (key === 'Escape'    || key === 'End')    { e.preventDefault(); _cls();    return; }

  // Joystick up/down → switch focus between Calculator and Unit Product
  if ((key === 'ArrowUp' || key === 'ArrowDown') && (state.mode === 'calc' || state.mode === 'box')) {
    e.preventDefault();
    setInputFocus(state.inputFocus === 'calc' ? 'unit' : 'calc');
    return;
  }
}
