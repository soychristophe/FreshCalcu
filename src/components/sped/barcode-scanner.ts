// ─── src/components/sped/barcode-scanner.ts ──────────────────────────────────
//
// Activates the device camera and detects barcodes.
//
// Strategy (in order):
//   1. BarcodeDetector API  — Chrome 86+, Android WebView, Samsung Browser.
//   2. ZXing-js             — lazy-loaded ONLY if BarcodeDetector is absent
//                             (covers iOS Safari, Firefox, older desktops).
//   3. Hard error           — camera not accessible at all → show message.
//
// The module is fully self-contained: it builds its own camera overlay,
// writes the detected code into #sped-barcode, and fires an 'input' event
// so the existing search flow runs exactly as if the user had typed.
//
// Nothing from this file ends up in the main bundle until openScanner() is
// called for the first time (ZXing import is always dynamic).
// ─────────────────────────────────────────────────────────────────────────────

/* ── Constants ────────────────────────────────────────────────────────────── */

/** CDN URL for the ZXing browser bundle (ESM). No npm install needed. */
const ZXING_CDN =
  'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/esm/index.js';

/**
 * BarcodeDetector formats to attempt.
 * Keep the list short — the browser skips unsupported formats automatically.
 */
const BARCODE_FORMATS: BarcodeFormat[] = [
  'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code',
];

/** Polling interval (ms) for the native BarcodeDetector loop. */
const NATIVE_POLL_MS = 250;

/* ── BarcodeFormat type (not in lib.dom yet everywhere) ──────────────────── */

type BarcodeFormat =
  | 'aztec' | 'code_128' | 'code_39' | 'code_93' | 'codabar'
  | 'data_matrix' | 'ean_13' | 'ean_8' | 'itf' | 'pdf417'
  | 'qr_code' | 'upc_a' | 'upc_e' | 'unknown';

interface NativeBarcode { rawValue: string; }

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement | ImageBitmap): Promise<NativeBarcode[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { formats: BarcodeFormat[] }): NativeBarcodeDetector;
  getSupportedFormats?(): Promise<BarcodeFormat[]>;
}

/* ── Overlay DOM ──────────────────────────────────────────────────────────── */

interface ScannerUI {
  overlay:   HTMLDivElement;
  video:     HTMLVideoElement;
  statusEl:  HTMLParagraphElement;
  closeBtn:  HTMLButtonElement;
  torchBtn:  HTMLButtonElement | null;
}

/** Injects the camera overlay into <body> and returns its elements. */
function buildOverlay(): ScannerUI {
  // Inject styles once
  if (!document.getElementById('bcs-styles')) {
    const style = document.createElement('style');
    style.id = 'bcs-styles';
    style.textContent = `
      #bcs-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: #000;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 0;
      }
      #bcs-overlay video {
        width: 100%; max-height: 70dvh;
        object-fit: cover;
        display: block;
      }
      #bcs-viewfinder {
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -55%);
        width: min(72vw, 300px);
        aspect-ratio: 3/2;
        border: 2.5px solid rgba(255,255,255,.85);
        border-radius: 10px;
        box-shadow: 0 0 0 9999px rgba(0,0,0,.45);
        pointer-events: none;
      }
      #bcs-viewfinder::after {
        content: '';
        position: absolute;
        top: 50%; left: 0; right: 0;
        height: 2px;
        background: linear-gradient(90deg,transparent,#4361ee,transparent);
        animation: bcs-scan 1.6s ease-in-out infinite;
      }
      @keyframes bcs-scan {
        0%,100% { top: 10%; opacity: .6; }
        50%      { top: 88%; opacity: 1; }
      }
      #bcs-toolbar {
        width: 100%; display: flex;
        align-items: center; justify-content: space-between;
        padding: 14px 20px;
        background: rgba(0,0,0,.7);
        gap: 12px;
      }
      #bcs-status {
        flex: 1; color: #fff; font-size: .85rem;
        text-align: center; margin: 0;
        opacity: .75;
      }
      .bcs-btn {
        background: rgba(255,255,255,.12);
        color: #fff; border: none;
        border-radius: 8px; cursor: pointer;
        font-size: .85rem; padding: 8px 14px;
        white-space: nowrap;
        transition: background .15s;
      }
      .bcs-btn:hover { background: rgba(255,255,255,.22); }
      .bcs-btn-close {
        background: rgba(220,50,50,.7);
        font-weight: 700; font-size: 1rem;
        padding: 8px 18px;
      }
      .bcs-btn-close:hover { background: rgba(220,50,50,.95); }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = 'bcs-overlay';

  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.setAttribute('autoplay', '');

  const viewfinder = document.createElement('div');
  viewfinder.id = 'bcs-viewfinder';

  const toolbar = document.createElement('div');
  toolbar.id = 'bcs-toolbar';

  const statusEl = document.createElement('p');
  statusEl.id = 'bcs-status';
  statusEl.textContent = 'Point the camera at a barcode…';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'bcs-btn bcs-btn-close';
  closeBtn.textContent = '✕ CLOSE';

  // Torch button — revealed only if the track supports it
  let torchBtn: HTMLButtonElement | null = null;
  if ('ImageCapture' in window) {
    torchBtn = document.createElement('button');
    torchBtn.className = 'bcs-btn';
    torchBtn.textContent = '🔦';
    torchBtn.title = 'Toggle torch';
    toolbar.appendChild(torchBtn);
  }

  toolbar.appendChild(statusEl);
  toolbar.appendChild(closeBtn);

  overlay.appendChild(video);
  overlay.appendChild(viewfinder);
  overlay.appendChild(toolbar);
  document.body.appendChild(overlay);

  return { overlay, video, statusEl, closeBtn, torchBtn: torchBtn ?? null };
}

/* ── Camera helpers ───────────────────────────────────────────────────────── */

async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach(t => t.stop());
}

/* ── Torch toggle ─────────────────────────────────────────────────────────── */

async function wireTorch(
  btn: HTMLButtonElement,
  stream: MediaStream,
): Promise<void> {
  const [track] = stream.getVideoTracks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caps = (track as any).getCapabilities?.() as Record<string, unknown> | undefined;
  if (!caps?.torch) { btn.style.display = 'none'; return; }

  let torchOn = false;
  btn.addEventListener('click', async () => {
    torchOn = !torchOn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (track as any).applyConstraints({ advanced: [{ torch: torchOn }] });
    btn.textContent = torchOn ? '🔦 ON' : '🔦';
  });
}

/* ── Dispatch detected value ──────────────────────────────────────────────── */

/**
 * Writes `value` into #sped-barcode and fires an 'input' event.
 * This is identical to what happens when the user types or uses a scanner gun.
 */
function dispatchToInput(value: string): void {
  const input = document.getElementById('sped-barcode') as HTMLInputElement | null;
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

/* ── Native BarcodeDetector strategy ─────────────────────────────────────── */

async function runNativeDetector(
  video: HTMLVideoElement,
  ui:    ScannerUI,
  onDetected: (code: string) => void,
): Promise<() => void> {
  const Ctor = (window as unknown as Record<string, unknown>)
    ['BarcodeDetector'] as NativeBarcodeDetectorConstructor;

  const detector = new Ctor({ formats: BARCODE_FORMATS });
  let running = true;

  ui.statusEl.textContent = 'Native detector active — point at barcode…';

  const poll = async (): Promise<void> => {
    if (!running || video.readyState < 2) {
      if (running) setTimeout(poll, NATIVE_POLL_MS);
      return;
    }
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        running = false;
        onDetected(barcodes[0].rawValue);
        return;
      }
    } catch {
      // frame not ready yet — keep polling
    }
    if (running) setTimeout(poll, NATIVE_POLL_MS);
  };

  poll();
  return () => { running = false; };
}

/* ── ZXing fallback strategy (lazy-loaded) ───────────────────────────────── */

async function runZXingDetector(
  video:    HTMLVideoElement,
  ui:       ScannerUI,
  onDetected: (code: string) => void,
): Promise<() => void> {
  ui.statusEl.textContent = 'Loading fallback decoder…';

  // Dynamic import — never included in the main bundle
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ZXing = await import(/* @vite-ignore */ ZXING_CDN) as any;

  const hints = new Map();
  // Prefer 1-D codes for warehouse use — faster on mobile
  hints.set(ZXing.DecodeHintType?.TRY_HARDER, true);

  const reader = new ZXing.BrowserMultiFormatReader(hints);

  ui.statusEl.textContent = 'ZXing active — point at barcode…';

  // ZXing drives the video element itself
  await reader.decodeFromVideoElement(video, (result: unknown, err: unknown) => {
    if (result) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onDetected((result as any).getText());
    } else if (err && !(err instanceof ZXing.NotFoundException)) {
      console.warn('[BarcodeScanner] ZXing error:', err);
    }
  });

  return () => { reader.reset(); };
}

/* ── Public API ───────────────────────────────────────────────────────────── */

/**
 * Opens the camera scanner overlay.
 *
 * Call from the "Scan" button in sped-step1:
 *   `import { openScanner } from './barcode-scanner';`
 *   `<button onclick="openScanner()">📷 Scan</button>`
 *
 * On detection the barcode is written into #sped-barcode and the existing
 * 'input' handler fires — no other integration needed.
 */
export async function openScanner(): Promise<void> {
  // Guard: don't open twice
  if (document.getElementById('bcs-overlay')) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Camera not available on this device or browser.');
    return;
  }

  const ui = buildOverlay();
  let stream: MediaStream | undefined;
  let stopDetector: (() => void) | undefined;

  /** Tear down everything and remove overlay */
  const close = (): void => {
    stopDetector?.();
    if (stream) stopStream(stream);
    ui.overlay.remove();
  };

  ui.closeBtn.addEventListener('click', close);

  /** Called when a barcode value is successfully read */
  const onDetected = (rawValue: string): void => {
    const trimmed = rawValue.trim();
    if (!trimmed) return;
    close();
    dispatchToInput(trimmed);
  };

  try {
    stream = await startCamera(ui.video);

    if (ui.torchBtn) {
      wireTorch(ui.torchBtn, stream);
    }

    const hasNative = 'BarcodeDetector' in window;

    if (hasNative) {
      stopDetector = await runNativeDetector(ui.video, ui, onDetected);
    } else {
      stopDetector = await runZXingDetector(ui.video, ui, onDetected);
    }
  } catch (err: unknown) {
    close();
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
      alert('Camera permission denied. Please allow camera access and try again.');
    } else {
      alert(`Could not start camera: ${msg}`);
    }
  }
}
