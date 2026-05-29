// ─── src/services/voiceService.ts ─────────────────────────────────────────────
// Encapsulates the Web Speech API (SpeechRecognition / webkitSpeechRecognition).
//
// Usage pattern:
//   if (voiceSupported) { addMicButton(); }
//   startVoice({ onResult: text => doSomethingWith(text) });
//
// Feature-detected at module load time — no errors on Firefox / older Safari.

/* ── Web Speech API type shims ───────────────────────────────────────────── */
// The standard types are not present in every TS lib version.
// We declare a minimal interface rather than relying on lib.dom.d.ts.

interface SpeechRecognitionResultItem {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionResultItem;
  [index: number]: SpeechRecognitionResultItem;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}
interface ISpeechRecognition extends EventTarget {
  lang:            string;
  interimResults:  boolean;
  maxAlternatives: number;
  continuous:      boolean;
  onresult:        ((e: SpeechRecognitionEvent) => void) | null;
  onend:           (() => void) | null;
  onerror:         ((e: Event) => void) | null;
  start():  void;
  stop():   void;
  abort():  void;
}

/* ── Feature detection ───────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _SRCtor: (new () => ISpeechRecognition) | undefined =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)['SpeechRecognition'] ?? (window as any)['webkitSpeechRecognition'] ?? undefined;

/** True if the browser supports SpeechRecognition. */
export const voiceSupported: boolean = _SRCtor !== undefined;

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface VoiceOptions {
  /** BCP 47 language tag, e.g. 'en-US'. Defaults to 'en-US'. */
  lang?:     string;
  /** Called with the final recognised transcript. */
  onResult:  (text: string) => void;
  /** Called when recognition ends (success or not). */
  onEnd?:    () => void;
  /** Called on recognition error. */
  onError?:  () => void;
}

/* ── API ─────────────────────────────────────────────────────────────────── */

/**
 * Starts a single-shot voice recognition session.
 * Does nothing if the browser does not support SpeechRecognition.
 *
 * @returns A stop function, or undefined if unsupported.
 */
export function startVoice(opts: VoiceOptions): (() => void) | undefined {
  if (!_SRCtor) return undefined;

  const rec: ISpeechRecognition = new _SRCtor();
  rec.lang             = opts.lang ?? 'en-US';
  rec.interimResults   = false;
  rec.maxAlternatives  = 1;
  rec.continuous       = false;

  rec.onresult = (e: SpeechRecognitionEvent) => {
    const transcript = e.results[0]?.[0]?.transcript ?? '';
    opts.onResult(transcript.trim());
  };

  rec.onend   = () => opts.onEnd?.();
  rec.onerror = () => { opts.onError?.(); opts.onEnd?.(); };

  rec.start();

  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Validates that a speech transcript represents a positive number.
 * Converts words like "four" → won't match (we rely on numeric speech mode).
 * Accepts e.g. "forty two" → NaN; "42" or "42.5" → valid.
 */
export function parseVoiceNumber(text: string): number | null {
  // Strip any spoken noise ("um", trailing dots, etc.)
  const cleaned = text.replace(/[^0-9.,]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isFinite(n) && n > 0 ? n : null;
}

/**
 * Creates and returns a mic button element styled to match the app's pill buttons.
 * The button is NOT appended to the DOM — caller handles placement.
 *
 * @param onActivate - Callback when the button is clicked.
 * @param ariaLabel  - Accessible label.
 */
export function createMicButton(
  onActivate: () => void,
  ariaLabel = 'Voice input',
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'btn-voice-mic';
  btn.ariaLabel = ariaLabel;
  btn.title     = ariaLabel;
  btn.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true">
       <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
       <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
       <line x1="12" y1="19" x2="12" y2="23"/>
       <line x1="8"  y1="23" x2="16" y2="23"/>
     </svg>`;

  btn.addEventListener('click', () => {
    onActivate();
    btn.classList.add('listening');
    setTimeout(() => btn.classList.remove('listening'), 5_000); // safety timeout
  });

  return btn;
}
