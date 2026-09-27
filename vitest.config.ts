import {existsSync} from 'node:fs';
import {defineConfig} from 'vitest/config';

// Backend tests run in Node; D1 / Durable Object SQLite storage is emulated
// with node:sqlite (see packages/testing). The web app has its own project.
// tests/** holds the in-process full-system suites: e2e flows, D1 write /
// CPU budgets (tests/budget) and response contract checks (tests/contract).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'backend',
          environment: 'node',
          include: [
            'packages/**/*_test.ts',
            'apps/!(web)/**/*_test.ts',
            'tests/**/*_test.ts',
          ],
        },
      },
      ...(existsSync('apps/web/vitest.config.ts')
        ? ['apps/web/vitest.config.ts']
        : []),
    ],
    // `pnpm test:coverage` (CI gate): domain layers ≥ 80% lines (详细设计
    // 表 14 单元测试).
    coverage: {
      provider: 'v8',
      include: ['packages/**/domain/**/*.ts'],
      exclude: ['**/*_test.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: {lines: 80},
    },
  },
});
