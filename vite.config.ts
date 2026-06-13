import { defineConfig } from 'vite';
import { VitePWA }      from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  /* ── Build-time constants (visible en consola y/o UI al abrir la app) ── */
  define: {
    __BUILD_DATE__:   JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__:   JSON.stringify(process.env['CF_PAGES_COMMIT_SHA'] ?? 'local'),
    __GIT_BRANCH__:   JSON.stringify(process.env['CF_PAGES_BRANCH']     ?? 'local'),
  },
  /* ── Root & entry ─────────────────────────────────────────────────── */
  root:    '.',
  base:    './',           // Relative paths — required for Cloudflare Pages

  /* ── Path aliases (mirror tsconfig.paths) ─────────────────────────── */
  resolve: {
    alias: {
      '@':           new URL('./src', import.meta.url).pathname,
      '@types':      new URL('./src/types', import.meta.url).pathname,
      '@config':     new URL('./src/config', import.meta.url).pathname,
      '@services':   new URL('./src/services', import.meta.url).pathname,
      '@utils':      new URL('./src/utils', import.meta.url).pathname,
      '@components': new URL('./src/components', import.meta.url).pathname,
      '@state':      new URL('./src/state', import.meta.url).pathname,
    },
  },

  /* ── Dev server ────────────────────────────────────────────────────── */
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target:       'https://freshways-api.soychristophe.workers.dev',
        changeOrigin: true,
        secure:       true,
      },
    },
  },

  /* ── Build ─────────────────────────────────────────────────────────── */
  build: {
    target:      'es2022',
    outDir:      'dist',
    emptyOutDir: true,
    sourcemap:   true,
    minify:      'esbuild',

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('src/services/api'))              return 'api';
          if (id.includes('src/services/productCache'))     return 'cache';
          if (id.includes('src/components/products-panel')) return 'products-panel';
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },

    assetsInlineLimit: 0,
  },

  /* ── CSS ────────────────────────────────────────────────────────────── */
  css: {
    devSourcemap: true,
  },

  envPrefix: 'VITE_',

  /* ── PWA / Service Worker ───────────────────────────────────────────── */
  plugins: [
    VitePWA({
      // generateSW: Workbox genera el SW automáticamente en cada build.
      // Precachea TODOS los assets (JS, CSS, HTML) con sus hashes → offline
      // funciona desde la primera visita con internet.
      strategies: 'generateSW',

      // El SW generado se emite como sw.js en la raíz del dist.
      filename: 'sw.js',

      // Registra el SW automáticamente con auto-update silencioso.
      // Cuando hay una nueva versión disponible, se activa en el siguiente reload.
      registerType: 'autoUpdate',

      // Incluye el helper de registro en el bundle (no necesitamos llamar a
      // navigator.serviceWorker.register() manualmente).
      injectRegister: 'auto',

      // Workbox config
      workbox: {
        // Precachear todo lo que Vite emite en /assets/ + index.html + manifest
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],

        // Navegación SPA: siempre servir index.html desde caché
        navigateFallback: 'index.html',

        // No aplicar navigateFallback a las llamadas a la API
        navigateFallbackDenylist: [/^\/api\//],

        // ── Estrategias de caché runtime ──────────────────────────────
        runtimeCaching: [
          // Assets de Vite con hash → CacheFirst (el hash garantiza frescura)
          {
            urlPattern: /\/assets\/.+\.(js|css)$/,
            handler:    'CacheFirst',
            options: {
              cacheName: 'fw-assets-v1',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          // Iconos y estáticos
          {
            urlPattern: /\/icons\/.+\.(png|svg|ico)$/,
            handler:    'CacheFirst',
            options: {
              cacheName: 'fw-icons-v1',
              expiration: { maxEntries: 20, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
          // API Cloudflare Worker: NetworkFirst con fallback a caché.
          // → Cuando hay internet, sirve fresh y actualiza caché.
          // → Sin internet, devuelve la última respuesta cacheada.
          {
            urlPattern: /freshcalcu\.soychristophe\.workers\.dev\/api\//,
            handler:    'NetworkFirst',
            options: {
              cacheName:           'fw-api-v1',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries:    200,
                maxAgeSeconds: 7 * 24 * 60 * 60,  // 7 días
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Proxy local /api/ (dev + Cloudflare Pages)
          {
            urlPattern: /\/api\//,
            handler:    'NetworkFirst',
            options: {
              cacheName:           'fw-api-local-v1',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries:    200,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],

        // Limpia caches antiguas de la versión manual
        cleanupOutdatedCaches: true,

        // El cliente coge el nuevo SW inmediatamente (sin esperar a cerrar tabs)
        skipWaiting:  true,
        clientsClaim: true,
      },

      // Reutiliza el manifest.json que ya tienes en /public/
      manifest: false,

      devOptions: {
        // Activa el SW en dev (útil para testear offline)
        enabled: false,
        type:    'module',
      },
    }),
  ],
});
