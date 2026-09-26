/**
 * @fileoverview Core loop against a running dev stack (`pnpm dev`):
 * login → import pack → 3 sources → alert appears on the cockpit →
 * scenario → approve recommendation → executed. Data setup goes through the
 * API (same flow as scripts/smoke.mjs); the decisive steps go through the UI.
 */

import {expect, test} from '@playwright/test';
import {Api, readSample, uiLogin} from './helpers';

const SOURCES = [
  {
    file: 'suppliers.csv',
    def: {
      name: 'Suppliers (e2e)',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Supplier',
        primaryKey: {from: 'supplierId'},
        fields: [
          {to: 'supplierId', from: 'supplierId'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'country', from: 'country'},
          {
            to: 'riskScore',
            from: 'riskScore',
            transform: 'toNumber|clamp(0,100)',
          },
          {to: 'capacity', from: 'capacity', transform: 'toNumber'},
          {to: 'onTimeRate', from: 'onTimeRate', transform: 'toNumber'},
          {to: 'status', from: 'status'},
          {to: 'contactEmail', from: 'contactEmail'},
        ],
        links: [
          {
            type: 'supplies',
            toType: 'Material',
            toKey: 'materials',
            split: ';',
            weightFrom: 'share',
          },
        ],
      },
    },
  },
  {
    file: 'materials.csv',
    def: {
      name: 'Materials (e2e)',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Material',
        primaryKey: {from: 'materialId'},
        fields: [
          {to: 'materialId', from: 'materialId'},
          {to: 'name', from: 'name'},
          {to: 'category', from: 'category'},
          {to: 'unitCost', from: 'unitCost', transform: 'toNumber'},
        ],
        links: [
          {type: 'usedIn', toType: 'Product', toKey: 'products', split: ';'},
        ],
      },
    },
  },
  {
    file: 'products.csv',
    def: {
      name: 'Products (e2e)',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Product',
        primaryKey: {from: 'productId'},
        fields: [
          {to: 'productId', from: 'productId'},
          {to: 'name', from: 'name'},
          {to: 'dailyDemand', from: 'dailyDemand', transform: 'toNumber'},
          {to: 'inventoryDays', from: 'inventoryDays', transform: 'toNumber'},
          {
            to: 'safetyStockDays',
            from: 'safetyStockDays',
            transform: 'toNumber',
          },
          {to: 'revenuePerUnit', from: 'revenuePerUnit', transform: 'toNumber'},
        ],
      },
    },
  },
];

test.describe.configure({mode: 'serial'});

test('login → import → alert → scenario → approve', async ({page, request}) => {
  test.setTimeout(180_000);
  const api = await Api.login(request);

  // 1. Import the built-in pack (publishes schema, installs automations + KPIs).
  await api.call('POST', '/ontology/packs:import', {packId: 'supply-chain'});

  // 2. Three sources + one batch each (seq 0, last true, jobId from presign).
  const ids: Record<string, string> = {};
  for (const s of SOURCES) {
    const existing = (
      await api.call<{id: string; name: string}[]>('GET', '/sources')
    ).find(x => x.name === s.def.name);
    const src =
      existing ?? (await api.call<{id: string}>('POST', '/sources', s.def));
    ids[s.file] = src.id;
    const pre = await api.call<{jobId: string}>(
      'POST',
      `/sources/${src.id}/uploads:presign`,
      {fileName: s.file, bytes: 512},
    );
    await api.call(
      'POST',
      `/sources/${src.id}/batches`,
      {jobId: pre.jobId, seq: 0, last: true, records: readSample(s.file)},
      {
        'idempotency-key': `${pre.jobId}:0`,
      },
    );
    await api.waitFor(
      async () =>
        (await api.call<{finishedAt?: string}>('GET', `/jobs/${pre.jobId}`))
          .finishedAt,
    );
  }

  // 3. Push S-002 above the risk threshold → HIGH alert + recommendation.
  const risky = readSample('suppliers.csv')
    .filter(r => r.supplierId === 'S-002')
    .map(r => ({...r, riskScore: '88'}));
  const pre = await api.call<{jobId: string}>(
    'POST',
    `/sources/${ids['suppliers.csv']}/uploads:presign`,
    {fileName: 'risk.csv', bytes: 128},
  );
  await api.call(
    'POST',
    `/sources/${ids['suppliers.csv']}/batches`,
    {jobId: pre.jobId, seq: 0, last: true, records: risky},
    {
      'idempotency-key': `${pre.jobId}:0`,
    },
  );

  // 4. UI: log in, the alert shows up on the cockpit.
  await uiLogin(page, '/cockpit');
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await expect(page.getByText('Hanoi Circuit Works').first()).toBeVisible({
    timeout: 60_000,
  });

  // 5. UI: scenario for the risky supplier.
  const hanoi = (
    await api.call<{rid: string; title: string}[]>(
      'GET',
      '/search?q=Hanoi&type=Supplier',
    )
  )[0];
  await page.goto(`/scenarios/new?rid=${encodeURIComponent(hanoi.rid)}`);
  await page
    .getByRole('button', {name: /运行推演|运行/})
    .first()
    .click();
  await expect(page.getByText('数值来自推演器，不经过 LLM')).toBeVisible({
    timeout: 30_000,
  });

  // 6. UI: approve the proposed recommendation.
  const rec = await api.waitFor(async () => {
    const recs = await api.call<{id: string; focus: string}[]>(
      'GET',
      '/recommendations?status=Proposed',
    );
    return recs.find(r => r.focus === hanoi.rid);
  }, 90_000);
  await page.goto(`/recommendations/${rec.id}`);
  await page.getByRole('button', {name: '批准并执行'}).click();
  await expect(
    page.getByRole('dialog', {name: '确认批准并执行'}),
  ).toBeVisible();
  await page.getByRole('button', {name: '确认执行'}).click();
  await expect(page.getByText('已执行').first()).toBeVisible({timeout: 30_000});
});

test('language switch keeps the page and updates <html lang>', async ({
  page,
}) => {
  await uiLogin(page, '/cockpit');
  await page.getByRole('button', {name: 'EN'}).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.getByRole('link', {name: 'Overview'})).toBeVisible();
  await expect(page).toHaveURL(/\/cockpit/);
});

test('wall mode hides navigation', async ({page}) => {
  await uiLogin(page, '/cockpit');
  await page.goto('/cockpit?mode=wall');
  await expect(page.getByRole('complementary', {name: '主导航'})).toHaveCount(
    0,
  );
  await expect(page.locator('html')).toHaveAttribute('data-wall', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
