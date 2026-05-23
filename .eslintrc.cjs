/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env:  { browser: true, es2022: true },

  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion:  'latest',
    sourceType:   'module',
    project:      './tsconfig.json',
    tsconfigRootDir: __dirname,
  },

  plugins: ['@typescript-eslint'],

  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],

  rules: {
    /* ── TypeScript ────────────────────────────────────────────────── */
    '@typescript-eslint/explicit-function-return-type':  'warn',
    '@typescript-eslint/no-explicit-any':               'error',
    '@typescript-eslint/no-non-null-assertion':         'warn',
    '@typescript-eslint/consistent-type-imports':       ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-unused-vars':                ['error', { argsIgnorePattern: '^_' }],

    /* ── Correctness ───────────────────────────────────────────────── */
    'no-console':          ['warn', { allow: ['warn', 'error'] }],
    'prefer-const':         'error',
    'no-var':               'error',
    'eqeqeq':              ['error', 'always'],

    /* ── Security: disallow eval-like patterns ─────────────────────── */
    'no-eval':              'error',
    'no-new-func':          'error',   // safeEval uses Function() — we handle it intentionally
  },

  ignorePatterns: ['dist/', 'node_modules/', 'public/sw.js', 'vite.config.ts'],
};
