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
 * Call once at app startup.
 * - Reads localStorage immediately (sync, offline-safe).
 * - Fires a background API refresh when online.
 *
 * This function never throws; failures are swallowed gracefully.
 */
export async function loadProductCache(): Promise<void> {
  if (cache.loaded || cache.loading) return;

  hydrateFromStorage();

  if (!navigator.onLine) return;

  cache.loading = true;
  try {
    const all = await apiGetAllProducts();
    if (all.length > 0) {
      cache.map    = new Map(all.map(p => [String(p.id), p]));
      cache.loaded = true;
      persist(all);
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

/* ── Local in-memory search ──────────────────────────────────────────────── */

function searchLocal(
  query: string,
  { limit = 50, exclude = [] }: SearchOptions = {},
): Product[] {
  const q      = query.trim().toLowerCase();
  const excSet = new Set(exclude.map(String));
  const isNum  = /^\d+$/.test(q);
  const hits: Product[] = [];

  for (const p of cache.map.values()) {
    if (excSet.has(String(p.id))) continue;
    const idStr   = String(p.id).toLowerCase();
    const nameStr = (p.name ?? '').toLowerCase();

    const matches = isNum
      ? idStr.includes(q)
      : idStr.includes(q) || nameStr.includes(q);

    if (matches) hits.push(p);
  }

  hits.sort((a, b) => {
    const ai = String(a.id);
    const bi = String(b.id);
    const ae = ai === query ? 0 : 1;
    const be = bi === query ? 0 : 1;
    if (ae !== be) return ae - be;
    return isNum
      ? ai.length - bi.length
      : (a.name ?? '').localeCompare(b.name ?? '');
  });

  return hits.slice(0, limit);
}
