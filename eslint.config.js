// ESLint flat config based on Google TypeScript Style (gts).
import gts from 'gts';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.wrangler/**',
      'apps/web/public/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
      'infra/**',
      '*.config.js',
      '.dependency-cruiser.cjs',
      '.prettierrc.cjs',
    ],
  },
  ...gts,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: null,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'n/no-unpublished-import': 'off',
      'n/no-missing-import': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-extraneous-import': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
    },
  },
  {
    // 前端详细设计 6.3.1: the SPA reaches the backend only through
    // shared/api (same-origin /api/v1) and shared/ws.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: [
      'apps/web/src/shared/api/**',
      'apps/web/src/shared/ws/**',
      'apps/web/src/test/**',
      'apps/web/src/**/*_test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {name: 'fetch', message: 'Use shared/api (same-origin /api/v1 only).'},
        {name: 'WebSocket', message: 'Use shared/ws.'},
        {name: 'EventSource', message: 'Use shared/ws.'},
      ],
      'no-restricted-properties': [
        'error',
        {object: 'window', property: 'fetch'},
        {object: 'globalThis', property: 'fetch'},
        {object: 'window', property: 'WebSocket'},
        {object: 'globalThis', property: 'WebSocket'},
        {object: 'navigator', property: 'sendBeacon'},
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
];
