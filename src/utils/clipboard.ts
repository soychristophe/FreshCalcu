// ─── src/utils/clipboard.ts ──────────────────────────────────────────────────

import { haptic } from '@/utils/dom.ts';

/**
 * Copies a value to the clipboard.
 * Strips leading "= " (calculator preview prefix).
 * Calls `onSuccess` (e.g. showToast) only if the write succeeds.
 */
export function copyToClipboard(
  text:      unknown,
  onSuccess: () => void = () => undefined,
): void {
  const clean = String(text ?? '').replace(/^= /, '').trim();
  if (!clean) return;
  navigator.clipboard
    .writeText(clean)
    .then(() => { haptic(); onSuccess(); })
    .catch(() => undefined);
}

/**
 * Reads the clipboard, returns the trimmed text or `null` on failure.
 */
export async function pasteFromClipboard(): Promise<string | null> {
  try {
    const text = await navigator.clipboard.readText();
    return text.trim() || null;
  } catch {
    return null;
  }
}
