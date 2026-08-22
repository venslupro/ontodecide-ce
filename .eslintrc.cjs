/**
 * Root ESLint configuration.
 * Extends the Google style guide for TypeScript and adds Cloudflare
 * Workers-specific globals (caches, crypto, btoa/atob, etc.).
 */
const path = require('path');

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: [
      path.resolve(__dirname, 'apps/shared/tsconfig.json'),
      path.resolve(__dirname, 'apps/api/gateway/tsconfig.json'),
      path.resolve(__dirname, 'apps/api/user/tsconfig.json'),
      path.resolve(__dirname, 'apps/api/graph/tsconfig.json'),
      path.resolve(__dirname, 'apps/api/ingestion/tsconfig.json'),
      path.resolve(__dirname, 'apps/api/ai/tsconfig.json'),
      path.resolve(__dirname, 'apps/api/cleanup/tsconfig.json'),
    ],
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'google',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  env: {
    es2022: true,
    worker: true,
  },
  globals: {
    caches: 'readonly',
    crypto: 'readonly',
    btoa: 'readonly',
    atob: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    fetch: 'readonly',
    Headers: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    FormData: 'readonly',
    DurableObject: 'readonly',
    DurableObjectNamespace: 'readonly',
    DurableObjectState: 'readonly',
    DurableObjectId: 'readonly',
    KVNamespace: 'readonly',
    R2Bucket: 'readonly',
    R2Object: 'readonly',
    Queue: 'readonly',
    MessageBatch: 'readonly',
    ExecutionContext: 'readonly',
    ScheduledEvent: 'readonly',
  },
  rules: {
    'max-len': ['error', {code: 100, ignoreUrls: true, ignoreStrings: true}],
    'require-jsdoc': 'off',
    'valid-jsdoc': 'off',
    'new-cap': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-unused-vars': 'off',
  },
  ignorePatterns: [
    'dist/',
    '.turbo/',
    'node_modules/',
    'infrastructure/',
    '*.config.js',
    '*.config.cjs',
    '*.config.ts',
  ],
};
