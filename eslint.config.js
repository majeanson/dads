import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

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
    // Only the two promise rules, not the whole type-checked set. On a Worker
    // an unawaited promise can drop a D1 write after the response has gone.
    // Only files a tsconfig owns: the rules need types.
    files: [
      'src/**/*.{ts,tsx}',
      'test/**/*.ts',
      'e2e/**/*.ts',
      'scripts/**/*.ts',
      'vite.config.ts',
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // `onSubmit={async …}` is how every form here is written; React ignores
      // what a handler returns.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    // The two classic rules. The React Compiler's rules (refs, purity,
    // set-state-in-effect) are left off: there is no compiler here, and a ref
    // written during render is sometimes the point (`useFreshBuild`).
    files: ['src/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
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
