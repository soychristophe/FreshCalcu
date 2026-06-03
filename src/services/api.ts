// ─── src/services/api.ts ──────────────────────────────────────────────────────
// Typed HTTP client for the Cloudflare D1 Worker.
// All methods are pure async functions — no side effects, no DOM access.
// Callers are responsible for error handling.

import { API_BASE, TIMEOUT } from '@/config/constants.ts';
import type {
  Product,
  ProductPage,
  RemoteHistoryEntry,
  HistoryAllPage,
  SearchOptions,
  HistoryAllOptions,
} from '@/types/index.ts';

/* ── Helpers ────────────────────────────────────────────────────────────── */

function signal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const res = await fetch(url, { signal: signal(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json() as Promise<T>;
}

/* ── Products ────────────────────────────────────────────────────────────── */

/**
 * Fuzzy-search products by query string.
 * Supports `limit` and `exclude` (comma-joined product IDs).
 */
export async function apiSearchProducts(
  query: string,
  { limit = 50, exclude = [] }: SearchOptions = {},
): Promise<Product[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (exclude.length) params.set('exclude', exclude.join(','));
  return getJson<Product[]>(`${API_BASE}/api/products?${params}`, TIMEOUT.SEARCH);
}

/**
 * Exact lookup by product ID.
 * Returns `null` on 404 (product not found) vs throwing on other errors.
 */
export async function apiGetProduct(id: string): Promise<Product | null> {
  const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(id)}`, {
    signal: signal(TIMEOUT.SEARCH),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Product>;
}

/**
 * Fetches ALL products paginated.
 * Used to hydrate the in-memory product cache on startup.
 */
export async function apiGetAllProducts(): Promise<Product[]> {
  // Primera página para saber el total de páginas
  const first = await getJson<ProductPage>(
    `${API_BASE}/api/products/all?page=1&limit=200`,
    TIMEOUT.PRODUCT_ALL,
  );
  if (first.pages <= 1) return first.products;

  // Páginas restantes en paralelo.
  // Promise.allSettled — si una página falla (timeout, error de red) las demás
  // se procesan igualmente y el caché se hidrata con lo que llegó.
  const settled = await Promise.allSettled(
    Array.from({ length: first.pages - 1 }, (_, i) =>
      getJson<ProductPage>(
        `${API_BASE}/api/products/all?page=${i + 2}&limit=200`,
        TIMEOUT.PRODUCT_ALL,
      ),
    ),
  );

  const rest = settled
    .filter((r): r is PromiseFulfilledResult<ProductPage> => r.status === 'fulfilled')
    .map(r => r.value);

  return [first, ...rest].flatMap(p => p.products);
}

/** Create a new product. */
export async function apiCreateProduct(
  payload: Omit<Product, 'values'> & { values: string[] },
): Promise<Product> {
  const res = await fetch(`${API_BASE}/api/products`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  signal(TIMEOUT.HISTORY),
  });
  const data = await res.json() as Product | { error: string };
  if (!res.ok) throw new Error('error' in data ? data.error : `HTTP ${res.status}`);
  return data as Product;
}

/** Update an existing product (name, sku, values only — ID is immutable). */
export async function apiUpdateProduct(
  id: string,
  payload: Partial<Pick<Product, 'name' | 'sku'>> & { values?: string[] },
): Promise<Product> {
  const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(id)}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  signal(TIMEOUT.HISTORY),
  });
  const data = await res.json() as Product | { error: string };
  if (!res.ok) throw new Error('error' in data ? data.error : `HTTP ${res.status}`);
  return data as Product;
}

/** Delete a product by ID. Resolves on 200 or 204. */
export async function apiDeleteProduct(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/products/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: signal(TIMEOUT.HISTORY),
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

/* ── History ─────────────────────────────────────────────────────────────── */

export async function apiAddHistory(
  barcodeId:   string,
  productName: string,
  qty:         number | null = null,
  pullQty:     number | null = null,
): Promise<void> {
  await fetch(`${API_BASE}/api/history`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      barcode_id:   barcodeId,
      product_name: productName,
      qty:          qty ?? null,
      pull_qty:     pullQty ?? null,
      client_time:  new Date().toISOString(),
    }),
    signal:  signal(TIMEOUT.HISTORY),
  });
}

export async function apiGetHistory(): Promise<RemoteHistoryEntry[] | null> {
  const res = await fetch(`${API_BASE}/api/history`, { signal: signal(TIMEOUT.HISTORY) });
  if (!res.ok) return null;
  return res.json() as Promise<RemoteHistoryEntry[]>;
}

export async function apiClearHistory(): Promise<void> {
  await fetch(`${API_BASE}/api/history`, {
    method: 'DELETE',
    signal: signal(TIMEOUT.HISTORY),
  });
}

export async function apiDeleteHistoryEntry(rowId: number): Promise<void> {
  await fetch(`${API_BASE}/api/history/${rowId}`, {
    method: 'DELETE',
    signal: signal(TIMEOUT.HISTORY),
  });
}

/* ── History All (audit log) ────────────────────────────────────────────── */

export async function apiAddHistoryAll(
  barcodeId:   string,
  productName: string,
  qty:         number | null,
  pullQty:     number | null,
): Promise<void> {
  await fetch(`${API_BASE}/api/history-all`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      barcode_id:    barcodeId,
      product_name:  productName,
      qty:           qty ?? null,
      pull_qty:      pullQty ?? null,
      client_time:   new Date().toISOString(), // preserve device local timezone
    }),
    signal: signal(TIMEOUT.HISTORY),
  });
}

/** Delete a single history-all entry by its row id. */
export async function apiDeleteHistoryAllEntry(rowId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/history-all/${rowId}`, {
    method: 'DELETE',
    signal: signal(TIMEOUT.HISTORY),
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
}

export async function apiGetHistoryAll({
  from = '', to = '', page = 1, limit = 200,
}: HistoryAllOptions = {}): Promise<HistoryAllPage | null> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  const res = await fetch(`${API_BASE}/api/history-all?${params}`, {
    signal: signal(TIMEOUT.HISTORY_ALL),
  });
  if (!res.ok) return null;
  return res.json() as Promise<HistoryAllPage>;
}

export async function apiClearHistoryAll(): Promise<void> {
  await fetch(`${API_BASE}/api/history-all`, {
    method: 'DELETE',
    signal: signal(TIMEOUT.HISTORY),
  });
}

/* ── Paginated products for the Products Panel ────────────────────────────── */

export async function apiGetProductsPage(
  page: number,
  limit: number,
  query?: string,
): Promise<ProductPage> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (query) params.set('q', query);
  return getJson<ProductPage>(
    `${API_BASE}/api/products/all?${params}`,
    TIMEOUT.HISTORY,
  );
}
