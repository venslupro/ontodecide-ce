/**
 * @fileoverview The public pages must not load the app shell: the router
 * (part of the entry chunk) imports AppLayout lazily only (前端详细设计 表 1:
 * /ended and /archive-deletions JS ≤ 60 KB, 不加载应用外壳). The built sizes
 * are checked by `scripts/check_bundle.mjs`.
 */

import {describe, expect, it} from 'vitest';
import routerSource from './router.tsx?raw';

describe('router', () => {
  it('imports the app shell only lazily', () => {
    expect(routerSource).not.toMatch(
      /^import[^;]*from\s+'\.\/layouts\/app_layout'/m,
    );
    expect(routerSource).toMatch(/import\('\.\/layouts\/app_layout'\)/);
  });
});
