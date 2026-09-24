/**
 * @fileoverview Vitest project for the web app (jsdom + Testing Library +
 * MSW). Picked up by the root vitest workspace as project `web`.
 */

import {fileURLToPath, URL} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {'@': fileURLToPath(new URL('./src', import.meta.url))},
  },
  define: {__APP_VERSION__: JSON.stringify('test')},
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*_test.{ts,tsx}'],
    css: false,
    // i18next-icu default-imports intl-messageformat, which only works through
    // the ESM `module` entry; inline both so Vite resolves them.
    server: {deps: {inline: ['i18next-icu', 'intl-messageformat']}},
    testTimeout: 15_000,
  },
});
