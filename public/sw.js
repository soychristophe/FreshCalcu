// ─── public/sw.js ────────────────────────────────────────────────────────────
// Service Worker for FreshWays Pro.
//
// Strategy:
//   • Static shell (HTML + assets) → Cache-first with network fallback.
//   • /api/* requests              → Network-only (never cached).
//   • Vite hashed assets           → Cache-first; hash change = new file = auto-bust.
//
// ⚠️  This file lives in /public/ and is NOT processed by Vite.
//     Keep it vanilla JS / no imports.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'freshways-v2-shell';

// Core shell assets cached at install time.
// Vite hashed bundles (/assets/*.js) are added to the cache lazily on first
// fetch, so we don't need to enumerate them here (they change every build).
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './public/icons/72.png',
  './public/icons/192.png',
  './public/icons/512.png',
];

/* ── Install ─────────────────────────────────────────────────────────────── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

/* ── Activate ────────────────────────────────────────────────────────────── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

/* ── Fetch ───────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // ── API calls: always network, never cache ─────────────────────────────
  if (url.pathname.startsWith('/api/')) return;

  // ── Navigation: cache-first, network fallback, Safari fix ─────────────
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        let response = await cache.match('./index.html');

        // Safari sometimes stores redirected responses — unwrap them.
        if (response?.redirected) {
          const body = await response.blob();
          response = new Response(body, {
            status:  200,
            statusText: 'OK',
            headers: response.headers,
          });
        }

        if (response) return response;

        return fetch(e.request).catch(() =>
          new Response('Offline — cache not yet populated', { status: 503 }),
        );
      }),
    );
    return;
  }

  // ── Vite hashed assets (/assets/*.js, /assets/*.css) ──────────────────
  // Cache-first: if the hash changes Vite requests a new URL, so the old
  // cached entry is simply never requested again — no manual invalidation.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        const fresh = await fetch(e.request);
        if (fresh.ok) cache.put(e.request, fresh.clone());
        return fresh;
      }),
    );
    return;
  }

  // ── Everything else: cache-first, network fallback ────────────────────
  e.respondWith(
    caches.match(e.request).then(res => res ?? fetch(e.request)),
  );
});
