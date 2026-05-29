// ─── src/components/sped/barcode-scanner.ts ──────────────────────────────────
// Camera-based barcode scanning using the native BarcodeDetector API.
// Falls back gracefully when BarcodeDetector is not available.
// Loaded lazily — not included in the main bundle.
export type OnDetectedFn = (rawValue: string) => void;
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
  // 🔧 Extiende los tipos nativos de TS para soportar focusMode en WebRTC
  interface MediaTrackConstraintSet {
    focusMode?: 'continuous' | 'manual' | 'single-shot';
  }
}

/* ── State ───────────────────────────────────────────────────────────────── */
let _stream:      MediaStream | null       = null;
let _animFrame:   number | null           = null;
let _detector:    BarcodeDetectorLike | null = null;
let _video:       HTMLVideoElement | null = null;
let _onDetected:  OnDetectedFn | null     = null;

/* ── Public API ──────────────────────────────────────────────────────────── */
export function isBarcodeDetectorSupported(): boolean {
  return typeof window.BarcodeDetector !== 'undefined';
}

export async function startScanner(
  container:   HTMLElement,
  onDetected:  OnDetectedFn,
): Promise<void> {
  if (!isBarcodeDetectorSupported()) {
    throw new Error('BarcodeDetector not supported in this browser');
  }
  _onDetected = onDetected;

  // 🟢 Formatos explícitos para retail/GTIN/EAN/UPC
  _detector = new window.BarcodeDetector!({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
  });

  _stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
      // ✅ Ahora type-safe gracias a la extensión global de arriba
      advanced: [{ focusMode: 'continuous' }]
    },
    audio: false,
  });

  _video = document.createElement('video');
  _video.srcObject    = _stream;
  _video.autoplay     = true;
  _video.muted        = true;
  _video.playsInline  = true;
  _video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;background:#000;';
  container.replaceChildren(_video);
  await _video.play();

  // ⏱️ CRÍTICO: Esperar 800ms a que la cámara ajuste enfoque y exposición
  await new Promise(resolve => setTimeout(resolve, 800));
  scheduleDetection();
}

export function stopScanner(container?: HTMLElement): void {
  if (_animFrame !== null) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  if (_video)  { _video.srcObject = null; _video = null; }
  if (container) container.replaceChildren();
  _detector   = null;
  _onDetected = null;
}

/* ── Detection loop ──────────────────────────────────────────────────────── */
function scheduleDetection(): void {
  _animFrame = requestAnimationFrame(() => void detect());
}

async function detect(): Promise<void> {
  if (!_video || !_detector || !_onDetected) return;
  if (_video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) {
    scheduleDetection();
    return;
  }

  try {
    // Algunos navegadores devuelven null en lugar de []
    const barcodes = await _detector.detect(_video) ?? [];
    const first = barcodes[0];
    
    if (first && first.rawValue) {
      _onDetected(first.rawValue);
      return; // Pausa el loop hasta que el caller lo reinicie
    }
  } catch {
    /* Silenciar errores de frames individuales, mantener loop */
  }
  scheduleDetection();
}