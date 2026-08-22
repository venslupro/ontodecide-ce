import {defineConfig} from 'vitest/config';

/**
 * Root Vitest configuration.
 *
 * All packages share this config; per-package scripts run `vitest run`
 * from their own directory, and Vitest resolves this root config.
 *
 * The default Node environment is used because our unit tests exercise
 * domain logic and shared utilities (WebCrypto is available natively in
 * Node ≥ 20). Workers-pool integration tests that need D1/KV/R2 bindings
 * would require a separate vitest config (not currently in use).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/tests/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['apps/**/src/**/*.ts'],
      exclude: ['**/tests/**', '**/index.ts', '**/types/**'],
    },
  },
});
