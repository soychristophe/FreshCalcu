import { defineConfig, loadEnv } from 'vite';
import { VitePWA }               from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv lee las variables de entorno del sistema (incluyendo las de CF Pages)
  // sin necesitar @types/node. El tercer argumento '' permite leer TODAS las vars
  // (no sólo las prefijadas con VITE_).
  const env = loadEnv(mode, '.', '');

  const commitSha = env['CF_PAGES_COMMIT_SHA'] ?? 'local';
  const branch    = env['CF_PAGES_BRANCH']     ?? 'local';

  return {
  /* ── Build-time constants ───────────────────────────────────────────────── */
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(commitSha),
    __GIT_BRANCH__: JSON.stringify(branch),
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
      strategies: 'generateSW',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],

        runtimeCaching: [
          {
            urlPattern: /\/assets\/.+\.(js|css)$/,
            handler:    'CacheFirst',
            options: {
              cacheName: 'fw-assets-v1',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /\/icons\/.+\.(png|svg|ico)$/,
            handler:    'CacheFirst',
            options: {
              cacheName: 'fw-icons-v1',
              expiration: { maxEntries: 20, maxAgeSeconds: 90 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /freshcalcu\.soychristophe\.workers\.dev\/api\//,
            handler:    'NetworkFirst',
            options: {
              cacheName:           'fw-api-v1',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries:    200,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
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

        cleanupOutdatedCaches: true,
        skipWaiting:  true,
        clientsClaim: true,
      },

      manifest: false,

      devOptions: {
        enabled: false,
        type:    'module',
      },
    }),
  ],
  };
});
