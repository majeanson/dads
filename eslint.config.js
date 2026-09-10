import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.wrangler/**',
      'node_modules/**',
      'playwright-report/**',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Build-time scripts run in Node, not in a Worker or a browser. Declared
    // by hand rather than pulling in the `globals` package for six names.
    files: ['scripts/**/*.{js,mjs,ts}', 'e2e/**/*.ts', '*.config.{js,ts}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        crypto: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    // The service worker is neither a Worker nor a page: its global is `self`,
    // and it is plain JavaScript served as-is from public/.
    files: ['public/sw.js'],
    languageOptions: {
      globals: { self: 'readonly' },
    },
  },
);
