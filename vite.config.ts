import { defineConfig } from 'vite';
import { resolve }      from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  /* ── Root & entry ─────────────────────────────────────────────────── */
  root:    '.',
  base:    './',           // Relative paths — required for Cloudflare Pages

  /* ── Path aliases (mirror tsconfig.paths) ─────────────────────────── */
  resolve: {
    alias: {
      '@':           resolve(__dirname, './src'),
      '@types':      resolve(__dirname, './src/types'),
      '@config':     resolve(__dirname, './src/config'),
      '@services':   resolve(__dirname, './src/services'),
      '@utils':      resolve(__dirname, './src/utils'),
      '@components': resolve(__dirname, './src/components'),
      '@state':      resolve(__dirname, './src/state'),
    },
  },

  /* ── Dev server ────────────────────────────────────────────────────── */
  server: {
    port: 3000,
    open: true,
    /* Proxy API calls to the real Worker during local dev.
       Remove if you have a .dev.vars / wrangler setup instead. */
    proxy: {
      '/api': {
        target:      'https://freshways-api.soychristophe.workers.dev',
        changeOrigin: true,
        secure:       true,
      },
    },
  },

  /* ── Build ─────────────────────────────────────────────────────────── */
  build: {
    target:        'es2022',          // All modern browsers
    outDir:        'dist',
    emptyOutDir:   true,
    sourcemap:     true,              // Keep for debugging — strip in CI if desired
    minify:        'esbuild',

    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },

      output: {
        /* ── Chunk splitting strategy ───────────────────────────────── */
        manualChunks(id) {
          // Keep the service worker and manifest out of JS chunks
          if (id.includes('src/services/api'))          return 'api';
          if (id.includes('src/services/productCache')) return 'cache';
          if (id.includes('src/components/products-panel')) return 'products-panel';
        },

        /* ── Hashed filenames for long-lived caching ────────────────── */
        entryFileNames:  'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',
      },
    },

    /* ── Avoid inlining assets that the SW needs to pre-cache ────────── */
    assetsInlineLimit: 0,
  },

  /* ── CSS ────────────────────────────────────────────────────────────── */
  css: {
    devSourcemap: true,
  },

  /* ── Env variable prefix ────────────────────────────────────────────── */
  // Vite exposes VITE_* vars to the browser via import.meta.env
  // Set VITE_DELETE_PIN in .env.local (never commit it)
  envPrefix: 'VITE_',
});
