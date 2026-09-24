import {existsSync} from 'node:fs';
import {defineConfig} from 'vitest/config';

// Backend tests run in Node; D1 / Durable Object SQLite storage is emulated
// with node:sqlite (see packages/testing). The web app has its own project.
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
    coverage: {
      provider: 'v8',
      include: ['packages/**/domain/**/*.ts'],
      exclude: ['**/*_test.ts'],
    },
  },
});
