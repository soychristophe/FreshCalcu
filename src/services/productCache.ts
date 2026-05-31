// ─── src/services/productCache.ts ─────────────────────────────────────────────
// In-memory product cache with localStorage persistence.
//
// Strategy:
//   1. Hydrate from localStorage immediately (offline-safe, instant).
//   2. Refresh from the API in the background (non-blocking).
//
// All SPED searches hit this Map → zero fetch per keystroke after load.

import { STORAGE_KEY } from '@/config/constants.ts';
import { apiGetAllProducts, apiSearchProducts } from '@/services/api.ts';
import type { Product, SearchOptions } from '@/types/index.ts';

/* ── Internal state (module-private) ────────────────────────────────────── */

interface CacheState {
  map:     Map<string, Product>;
  loaded:  boolean;
  loading: boolean;
}

const cache: CacheState = {
  map:     new Map(),
  loaded:  false,
  loading: false,
};

/* ── Persistence ─────────────────────────────────────────────────────────── */

function persist(products: Product[]): void {
  try {
    localStorage.setItem(STORAGE_KEY.PRODUCTS, JSON.stringify(products));
  } catch {
    /* Quota exceeded or private browsing — silently ignore */
  }
}

/** Saves an ISO timestamp marking the last successful refresh. */
function persistCacheTimestamp(): void {
  try {
    localStorage.setItem(STORAGE_KEY.PRODUCT_CACHE_TS, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

/** Returns the ISO timestamp of the last successful cache refresh, or null. */
export function getCacheTimestamp(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY.PRODUCT_CACHE_TS);
  } catch {
    return null;
  }
}

function hydrateFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY.PRODUCTS);
    if (!raw) return false;
    const arr = JSON.parse(raw) as Product[];
    cache.map    = new Map(arr.map(p => [String(p.id), p]));
    cache.loaded = true;
    return true;
  } catch {
    return false;
  }
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Android reports navigator.onLine = false for ~1 s after cold start even
 * when real connectivity exists.  Wait up to maxWaitMs for the 'online' event.
 */
async function waitForOnline(maxWaitMs = 3000): Promise<boolean> {
  if (navigator.onLine) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, maxWaitMs);
    const handler = () => { cleanup(); resolve(true); };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('online', handler);
    };
    window.addEventListener('online', handler, { once: true });
  });
}

/**
 * Call once at app startup.
 * - Reads localStorage immediately (sync, offline-safe).\n * - Fires a background API refresh when online.
 *
 * This function never throws; failures are swallowed gracefully.
 */
export async function loadProductCache(): Promise<void> {
  if (cache.loaded || cache.loading) return;

  hydrateFromStorage();

  const online = await waitForOnline();
  if (!online) return;

  cache.loading = true;
  try {
    const all = await apiGetAllProducts();
    if (all.length > 0) {
      cache.map    = new Map(all.map(p => [String(p.id), p]));
      cache.loaded = true;
      persist(all);
      persistCacheTimestamp();
    }
  } catch {
    /* Keep whatever was already in the Map */
  } finally {
    cache.loading = false;
  }
}

/**
 * Force a full cache refresh.
 * Called by the Products Panel after any CRUD operation.
 */
export async function refreshProductCache(): Promise<void> {
  cache.loaded  = false;
  cache.loading = false;
  try {
    localStorage.removeItem(STORAGE_KEY.PRODUCTS);
  } catch {
    /* ignore */
  }
  await loadProductCache();
}

/**
 * Exact lookup by ID.
 * Cache-first; falls back to API if cache isn't loaded yet.
 */
export async function findProduct(id: string): Promise<Product | null> {
  if (cache.loaded) return cache.map.get(String(id)) ?? null;
  try {
    const { apiGetProduct } = await import('@/services/api.ts');
    return await apiGetProduct(id);
  } catch {
    return null;
  }
}

/**
 * Fuzzy search.
 * Cache-first; falls back to API if cache isn't loaded yet.
 */
export async function searchProducts(
  query: string,
  opts: SearchOptions = {},
): Promise<Product[]> {
  if (cache.loaded) return searchLocal(query, opts);
  try {
    return await apiSearchProducts(query, opts);
  } catch {
    return [];
  }
}

/* ── Local in-memory search (improved) ──────────────────────────────────── */
//
// Search priority:
//   1. Exact ID match
//   2. Exact-normalised match (ID or name starts with query)
//   3. Partial match on any word in name/ID
//   4. Fuzzy (Levenshtein = 1) on individual query words > 4 chars

/** Strip diacritics: "café" → "cafe", "Ñoño" → "Nono". */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Levenshtein distance, capped at 2 for efficiency.
 * Returns the true distance if ≤ 2, else 99.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 2) return 99;

  // Use two-row DP
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  let curr = new Array<number>(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? (prev[j - 1] ?? 0)
        : 1 + Math.min(prev[j] ?? 0, curr[j - 1] ?? 0, prev[j - 1] ?? 0);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb] ?? 99;
}

type MatchTier = 0 | 1 | 2 | 3;  // 0 = exact, 1 = prefix/contains, 2 = word, 3 = fuzzy

interface ScoredProduct {
  product: Product;
  tier:    MatchTier;
}

function searchLocal(
  query: string,
  { limit = 50, exclude = [] }: SearchOptions = {},
): Product[] {
  const raw    = query.trim();
  if (!raw) return [];

  const q      = normalise(raw);
  const words  = q.split(/\s+/).filter(w => w.length > 0);
  const excSet = new Set(exclude.map(String));
  const isNum  = /^\d+$/.test(q);

  const results: ScoredProduct[] = [];

  for (const p of cache.map.values()) {
    if (excSet.has(String(p.id))) continue;

    const idRaw   = String(p.id);
    const idNorm  = normalise(idRaw);
    const nameNorm = normalise(p.name ?? '');

    let tier: MatchTier | null = null;

    if (isNum) {
      // Numeric queries: only match against id
      if (idNorm === q)              tier = 0;
      else if (idNorm.includes(q))   tier = 1;
    } else if (words.length === 1) {
      const w = words[0]!;
      // Single-word query
      if (idNorm === w || nameNorm === w)                            tier = 0;
      else if (idNorm.startsWith(w) || nameNorm.startsWith(w))      tier = 1;
      else if (idNorm.includes(w)  || nameNorm.includes(w))         tier = 1;
      else if (w.length > 4) {
        // Fuzzy: check each word token in the name
        const nameWords = nameNorm.split(/\s+/);
        for (const nw of nameWords) {
          if (levenshtein(w, nw) <= 1) { tier = 3; break; }
        }
        if (tier === null && levenshtein(w, idNorm) <= 1) tier = 3;
      }
    } else {
      // Multi-word query: every query word must match somewhere in the name
      const combined = `${idNorm} ${nameNorm}`;
      const allMatch = words.every(w => combined.includes(w));

      if (allMatch) {
        tier = 2;
      } else if (words.some(w => w.length > 4)) {
        // Fuzzy pass: every word matches with ≤1 edit in some token
        const tokens = combined.split(/\s+/);
        const fuzzyAll = words.every(w =>
          combined.includes(w) ||
          (w.length > 4 && tokens.some(t => levenshtein(w, t) <= 1)),
        );
        if (fuzzyAll) tier = 3;
      }
    }

    if (tier !== null) results.push({ product: p, tier });
  }

  // Sort: tier asc, then by name / id length (shorter = more specific)
  results.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const ai = String(a.product.id), bi = String(b.product.id);
    if (isNum) return ai.length - bi.length;
    return (a.product.name ?? '').localeCompare(b.product.name ?? '');
  });

  return results.slice(0, limit).map(r => r.product);
}

/* ── Formula index ───────────────────────────────────────────────────────── */

/**
 * Returns every unique formula string found across all cached products.
 * Used by the formula-suggestion engine in the Calculator tab.
 */
export function getAllCachedFormulas(): string[] {
  const seen = new Set<string>();
  for (const product of cache.map.values()) {
    for (const formula of product.values) {
      if (formula) seen.add(formula);
    }
  }
  return [...seen];
}
