import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
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
});
