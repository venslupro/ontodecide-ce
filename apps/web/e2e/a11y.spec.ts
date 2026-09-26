/**
 * @fileoverview WCAG 2.1 AA checks with axe-core on the core pages, in both
 * themes.
 */

import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';
import {uiLogin} from './helpers';

const PAGES = [
  '/cockpit',
  '/objects',
  '/graph',
  '/scenarios',
  '/recommendations',
  '/sources',
  '/ontology',
  '/automations',
  '/admin/users',
  '/admin/health',
];

test('login page has no WCAG AA violations', async ({page}) => {
  await page.goto('/login');
  const r = await new AxeBuilder({page})
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(r.violations).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  test(`core pages have no WCAG AA violations (${theme})`, async ({page}) => {
    test.setTimeout(120_000);
    await page.addInitScript(
      t => localStorage.setItem('od.prefs', JSON.stringify({theme: t})),
      theme,
    );
    await uiLogin(page, '/cockpit');
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({page})
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Canvas charts/graphs are exposed via role=img + aria-label.
        .exclude('canvas')
        .analyze();
      expect(r.violations, `${path} (${theme})`).toEqual([]);
    }
  });
}
