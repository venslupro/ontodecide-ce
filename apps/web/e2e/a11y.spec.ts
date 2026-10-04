/**
 * @fileoverview WCAG 2.1 AA checks (axe-core) of the public platform pages
 * in both languages (single light theme). Skipped when no server answers.
 */

import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

test.beforeAll(async ({request}) => {
  const up = await request.get(BASE).then(
    r => r.ok(),
    () => false,
  );
  test.skip(!up, `no server at ${BASE}`);
});

for (const lang of ['zh', 'en']) {
  for (const path of ['/signup', '/login', '/ended']) {
    test(`${path} (${lang}) has no WCAG AA violations`, async ({page}) => {
      await page.emulateMedia({colorScheme: 'light'});
      await page.route('**/api/v1/**', route =>
        route.fulfill({
          status: 401,
          contentType: 'application/problem+json',
          body: '{"type":"about:blank","title":"x","status":401,"code":"UNAUTHENTICATED"}',
        }),
      );
      await page.route('**/challenges.cloudflare.com/**', route =>
        route.fulfill({contentType: 'text/javascript', body: ''}),
      );
      await page.goto(`${path}?lang=${lang}`);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({page})
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(r.violations.map(v => v.id)).toEqual([]);
    });
  }
}
