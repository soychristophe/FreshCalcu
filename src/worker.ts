// ─── src/worker.ts ────────────────────────────────────────────────────────────
// Cloudflare Worker — single D1 binding (DB → freshways-products).
// Tables: products, history, history_all
// ─────────────────────────────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
}

/* ── CORS helper ─────────────────────────────────────────────────────────── */

function cors(body: string | null, status = 200, extra: HeadersInit = {}): Response {
  const headers: Record<string, string> = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra as Record<string, string>,
  };
  return new Response(body, { status, headers });
}

function json(data: unknown, status = 200): Response {
  return cors(JSON.stringify(data), status);
}

function err(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

/* ── Router ──────────────────────────────────────────────────────────────── */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method       = request.method.toUpperCase();

    // Pre-flight
    if (method === 'OPTIONS') return cors(null, 204);

    // ── Products ────────────────────────────────────────────────────────────
    if (pathname === '/api/products' && method === 'GET') {
      return handleSearchProducts(request, env);
    }
    if (pathname === '/api/products' && method === 'POST') {
      return handleCreateProduct(request, env);
    }
    if (pathname === '/api/products/all' && method === 'GET') {
      return handleGetAllProducts(request, env);
    }
    const productMatch = pathname.match(/^\/api\/products\/(.+)$/);
    if (productMatch) {
      const id = decodeURIComponent(productMatch[1]!);
      if (method === 'GET')    return handleGetProduct(id, env);
      if (method === 'PUT')    return handleUpdateProduct(id, request, env);
      if (method === 'DELETE') return handleDeleteProduct(id, env);
    }

    // ── History (today's session) ───────────────────────────────────────────
    if (pathname === '/api/history') {
      if (method === 'GET')    return handleGetHistory(env);
      if (method === 'POST')   return handleAddHistory(request, env);
      if (method === 'DELETE') return handleClearHistory(env);
    }
    const historyRowMatch = pathname.match(/^\/api\/history\/(\d+)$/);
    if (historyRowMatch && method === 'DELETE') {
      return handleDeleteHistoryRow(Number(historyRowMatch[1]), env);
    }

    // ── History-all (audit log) ─────────────────────────────────────────────
    if (pathname === '/api/history-all') {
      if (method === 'GET')    return handleGetHistoryAll(request, env);
      if (method === 'POST')   return handleAddHistoryAll(request, env);
      if (method === 'DELETE') return handleClearHistoryAll(env);
    }

    return err('Not found', 404);
  },
};

/* ══════════════════════════════════════════════════════════════════════════════
   PRODUCTS
══════════════════════════════════════════════════════════════════════════════ */

async function handleSearchProducts(req: Request, env: Env): Promise<Response> {
  const url     = new URL(req.url);
  const q       = (url.searchParams.get('q') ?? '').trim();
  const limit   = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const exclude = url.searchParams.get('exclude')?.split(',').filter(Boolean) ?? [];

  if (!q) return json([]);

  const like = `%${q}%`;

  if (exclude.length === 0) {
    const rows = await env.DB
      .prepare(`SELECT id, name, sku, values FROM products WHERE name LIKE ?1 OR id LIKE ?1 LIMIT ?2`)
      .bind(like, limit)
      .all<{ id: string; name: string; sku: string | null; values: string }>();

    return json(rows.results.map(parseProduct));
  }

  const placeholders = exclude.map((_, i) => `?${i + 3}`).join(', ');
  const rows = await env.DB
    .prepare(
      `SELECT id, name, sku, values FROM products
       WHERE (name LIKE ?1 OR id LIKE ?1)
         AND id NOT IN (${placeholders})
       LIMIT ?2`,
    )
    .bind(like, limit, ...exclude)
    .all<{ id: string; name: string; sku: string | null; values: string }>();

  return json(rows.results.map(parseProduct));
}

async function handleGetAllProducts(req: Request, env: Env): Promise<Response> {
  const url   = new URL(req.url);
  const page  = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 500);
  const q     = (url.searchParams.get('q') ?? '').trim();
  const offset = (page - 1) * limit;

  let countRow: { total: number };
  let rows: { id: string; name: string; sku: string | null; values: string }[];

  if (q) {
    const like = `%${q}%`;
    countRow = (await env.DB
      .prepare(`SELECT COUNT(*) AS total FROM products WHERE name LIKE ?1 OR id LIKE ?1`)
      .bind(like)
      .first<{ total: number }>())!;
    const res = await env.DB
      .prepare(`SELECT id, name, sku, values FROM products WHERE name LIKE ?1 OR id LIKE ?1 ORDER BY name LIMIT ?2 OFFSET ?3`)
      .bind(like, limit, offset)
      .all<{ id: string; name: string; sku: string | null; values: string }>();
    rows = res.results;
  } else {
    countRow = (await env.DB
      .prepare(`SELECT COUNT(*) AS total FROM products`)
      .first<{ total: number }>())!;
    const res = await env.DB
      .prepare(`SELECT id, name, sku, values FROM products ORDER BY name LIMIT ?1 OFFSET ?2`)
      .bind(limit, offset)
      .all<{ id: string; name: string; sku: string | null; values: string }>();
    rows = res.results;
  }

  const total = countRow?.total ?? 0;
  return json({
    products: rows.map(parseProduct),
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
  });
}

async function handleGetProduct(id: string, env: Env): Promise<Response> {
  const row = await env.DB
    .prepare(`SELECT id, name, sku, values FROM products WHERE id = ?1`)
    .bind(id)
    .first<{ id: string; name: string; sku: string | null; values: string }>();

  if (!row) return err('Not found', 404);
  return json(parseProduct(row));
}

async function handleCreateProduct(req: Request, env: Env): Promise<Response> {
  const body = await req.json<{ id: string; name: string; sku?: string; values: string[] }>();
  if (!body.id || !body.name) return err('id and name are required');

  const valuesJson = JSON.stringify(body.values ?? []);
  try {
    await env.DB
      .prepare(`INSERT INTO products (id, name, sku, values) VALUES (?1, ?2, ?3, ?4)`)
      .bind(body.id, body.name, body.sku ?? null, valuesJson)
      .run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) return err('Product ID already exists', 409);
    throw e;
  }

  const created = await env.DB
    .prepare(`SELECT id, name, sku, values FROM products WHERE id = ?1`)
    .bind(body.id)
    .first<{ id: string; name: string; sku: string | null; values: string }>();

  return json(parseProduct(created!), 201);
}

async function handleUpdateProduct(id: string, req: Request, env: Env): Promise<Response> {
  const body = await req.json<{ name?: string; sku?: string; values?: string[] }>();

  const current = await env.DB
    .prepare(`SELECT id, name, sku, values FROM products WHERE id = ?1`)
    .bind(id)
    .first<{ id: string; name: string; sku: string | null; values: string }>();

  if (!current) return err('Not found', 404);

  const newName   = body.name   ?? current.name;
  const newSku    = body.sku    !== undefined ? body.sku : current.sku;
  const newValues = body.values !== undefined
    ? JSON.stringify(body.values)
    : current.values;

  await env.DB
    .prepare(`UPDATE products SET name = ?1, sku = ?2, values = ?3 WHERE id = ?4`)
    .bind(newName, newSku, newValues, id)
    .run();

  const updated = await env.DB
    .prepare(`SELECT id, name, sku, values FROM products WHERE id = ?1`)
    .bind(id)
    .first<{ id: string; name: string; sku: string | null; values: string }>();

  return json(parseProduct(updated!));
}

async function handleDeleteProduct(id: string, env: Env): Promise<Response> {
  const row = await env.DB
    .prepare(`SELECT id FROM products WHERE id = ?1`)
    .bind(id)
    .first<{ id: string }>();

  if (!row) return err('Not found', 404);

  await env.DB.prepare(`DELETE FROM products WHERE id = ?1`).bind(id).run();
  return cors(null, 204);
}

/* ══════════════════════════════════════════════════════════════════════════════
   HISTORY (today's session log)
══════════════════════════════════════════════════════════════════════════════ */

async function handleGetHistory(env: Env): Promise<Response> {
  const rows = await env.DB
    .prepare(`SELECT id AS rowId, barcode_id AS id, product_name AS name, scanned_at AS time
              FROM history
              ORDER BY scanned_at DESC`)
    .all<{ rowId: number; id: string; name: string; time: string }>();

  return json(rows.results);
}

async function handleAddHistory(req: Request, env: Env): Promise<Response> {
  const body = await req.json<{ barcode_id: string; product_name: string }>();
  if (!body.barcode_id) return err('barcode_id is required');

  await env.DB
    .prepare(`INSERT INTO history (barcode_id, product_name) VALUES (?1, ?2)`)
    .bind(body.barcode_id, body.product_name ?? '')
    .run();

  return cors(null, 201);
}

async function handleClearHistory(env: Env): Promise<Response> {
  await env.DB.prepare(`DELETE FROM history`).run();
  return cors(null, 204);
}

async function handleDeleteHistoryRow(rowId: number, env: Env): Promise<Response> {
  await env.DB.prepare(`DELETE FROM history WHERE id = ?1`).bind(rowId).run();
  return cors(null, 204);
}

/* ══════════════════════════════════════════════════════════════════════════════
   HISTORY-ALL (permanent audit log)
══════════════════════════════════════════════════════════════════════════════ */

async function handleGetHistoryAll(req: Request, env: Env): Promise<Response> {
  const url   = new URL(req.url);
  const from  = url.searchParams.get('from') ?? '';   // YYYY-MM-DD
  const to    = url.searchParams.get('to')   ?? '';
  const page  = Math.max(1, Number(url.searchParams.get('page')  ?? 1));
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 500);
  const offset = (page - 1) * limit;

  // Build WHERE clause from optional date filters
  const conditions: string[] = [];
  const binds: (string | number)[] = [];
  let bindIdx = 1;

  if (from) {
    conditions.push(`DATE(scanned_at) >= DATE(?${bindIdx++})`);
    binds.push(from);
  }
  if (to) {
    conditions.push(`DATE(scanned_at) <= DATE(?${bindIdx++})`);
    binds.push(to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await env.DB
    .prepare(`SELECT COUNT(*) AS total FROM history_all ${where}`)
    .bind(...binds)
    .first<{ total: number }>();

  const rows = await env.DB
    .prepare(
      `SELECT barcode_id, product_name, qty, pull_qty, scanned_at
       FROM history_all
       ${where}
       ORDER BY scanned_at DESC
       LIMIT ?${bindIdx} OFFSET ?${bindIdx + 1}`,
    )
    .bind(...binds, limit, offset)
    .all<{
      barcode_id:   string;
      product_name: string;
      qty:          number | null;
      pull_qty:     number | null;
      scanned_at:   string;
    }>();

  return json({
    entries: rows.results,
    total:   countRow?.total ?? 0,
  });
}

async function handleAddHistoryAll(req: Request, env: Env): Promise<Response> {
  const body = await req.json<{
    barcode_id:   string;
    product_name: string;
    qty:          number | null;
    pull_qty:     number | null;
  }>();

  if (!body.barcode_id) return err('barcode_id is required');

  await env.DB
    .prepare(
      `INSERT INTO history_all (barcode_id, product_name, qty, pull_qty)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(
      body.barcode_id,
      body.product_name  ?? '',
      body.qty           ?? null,
      body.pull_qty      ?? null,
    )
    .run();

  return cors(null, 201);
}

async function handleClearHistoryAll(env: Env): Promise<Response> {
  await env.DB.prepare(`DELETE FROM history_all`).run();
  return cors(null, 204);
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function parseProduct(row: {
  id: string;
  name: string;
  sku: string | null;
  values: string;
}) {
  let values: string[] = [];
  try { values = JSON.parse(row.values) as string[]; } catch { /* keep [] */ }
  return {
    id:     row.id,
    name:   row.name,
    sku:    row.sku ?? undefined,
    values,
  };
}
