/**
 * @fileoverview Business-page end-to-end flows in a real browser against
 * the Vite dev server, with `/api/v1/**` served by an in-page contract mock
 * (Playwright routing) built from the unit-test fixtures: cockpit → object
 * view → action with Idempotency-Key / If-Match → 412 conflict dialog →
 * recommendation confirmation (replay-safe) → CSV import in batches of ≤ 100
 * rows with a retried seq. The full-stack flow lives in `tests/e2e`.
 */

import {expect, test, type Page, type Route} from '@playwright/test';
import {
  makeJobs,
  makeObjects,
  makeOverview,
  makeQuotas,
  makeRecommendations,
  makeLinks,
  ontologyDto,
} from '../src/test/fixtures/business';

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const TOKEN = `e30.${b64({
  sub: 'u-1',
  role: 'owner',
  tid: 'ws-1',
  st: 'ACTIVE',
  texp: now + 3 * 86_400,
  sid: 's-1',
  amr: ['email'],
  iat: now,
  exp: now + 900,
})}.sig`;
const ME = {
  userId: 'u-1',
  email: 'wang.yun@example.com',
  role: 'owner',
  locale: 'zh-CN',
  timeZone: 'Asia/Shanghai',
  workspace: {
    tenantId: 'ws-1',
    kind: 'trial',
    status: 'ACTIVE',
    verifiedAt: new Date().toISOString(),
    trialExpiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    expiredAt: null,
  },
  sessions: {used: 1, limit: 3},
  quotas: makeQuotas(),
};

interface Seen {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Installs the contract mock; returns the recorded requests. */
async function mockApi(page: Page): Promise<Seen[]> {
  const seen: Seen[] = [];
  const objects = makeObjects();
  const recs = makeRecommendations();
  const jobs = makeJobs();
  const decisions = new Map<string, unknown>();
  const batches = new Map<number, unknown>();
  let failBatchOnce = true;
  let patchConflict = true;

  const json = (route: Route, body: unknown, status = 200, etag?: number) =>
    route.fulfill({
      status,
      contentType:
        status >= 400 ? 'application/problem+json' : 'application/json',
      headers: etag !== undefined ? {etag: `"v${etag}"`} : {},
      body: JSON.stringify(body),
    });
  const problem = (route: Route, status: number, code: string) =>
    json(
      route,
      {type: 'about:blank', title: code, status, code, traceId: 't'},
      status,
    );

  await page.route('**/api/v1/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    seen.push({method: req.method(), path, headers: req.headers(), body});
    const m = req.method();

    if (path === '/auth/sessions/refresh')
      return json(route, {accessToken: TOKEN, expiresIn: 900, me: ME});
    if (path === '/me') return json(route, ME);
    if (path === '/situation/stream-tickets')
      return problem(route, 503, 'UNAVAILABLE');
    if (path === '/ontology')
      return json(route, ontologyDto, 200, ontologyDto.etag);
    if (path === '/situation/overview')
      return json(route, {
        ...makeOverview(),
        recommendations: recs.filter(r => r.status === 'Proposed'),
        quotas: ME.quotas,
      });
    if (path === '/alerts')
      return json(route, {items: makeOverview().alerts, nextCursor: null});
    if (path === '/objects/stats')
      return json(route, {
        objects: objects.length,
        links: 4,
        byType: {Supplier: 8},
      });
    if (path === '/objects') {
      const type = url.searchParams.get('type');
      return json(route, {
        items: objects.filter(o => !type || o.type === type),
        nextCursor: null,
      });
    }
    const obj = /^\/objects\/([^/]+)(\/(links|actions))?$/.exec(path);
    if (obj) {
      const o = objects.find(x => x.rid === decodeURIComponent(obj[1]));
      if (!o) return problem(route, 404, 'NOT_FOUND');
      if (obj[3] === 'actions')
        return json(route, {items: [], nextCursor: null});
      if (obj[3] === 'links') {
        const nodes = objects.slice(0, 5).map((x, i) => ({
          rid: x.rid,
          type: x.type,
          title: x.title,
          props: x.props,
          hop: i ? 1 : 0,
        }));
        return json(route, {nodes, edges: makeLinks(), truncated: false});
      }
      if (m === 'PATCH') {
        if (patchConflict) {
          patchConflict = false;
          return problem(route, 412, 'PRECONDITION_FAILED');
        }
        Object.assign(o.props, body);
        o.version += 1;
      }
      return json(route, o, 200, o.version);
    }
    const exec = /^\/action-types\/([^/]+)\/executions$/.exec(path);
    if (exec) {
      const o = objects.find(x => x.rid === body.target)!;
      return json(route, {
        actionLogId: 'al-x',
        actionType: exec[1],
        rid: o.rid,
        version: o.version + 1,
        before: {},
        after: {},
        executedAt: new Date().toISOString(),
        replayed: false,
      });
    }
    if (path === '/recommendations')
      return json(route, {
        items: recs.filter(
          r =>
            !url.searchParams.get('status') ||
            r.status === url.searchParams.get('status'),
        ),
        nextCursor: null,
      });
    const rec = /^\/recommendations\/([^/]+)(\/decision)?$/.exec(path);
    if (rec) {
      const r = recs.find(x => x.id === rec[1]);
      if (!r) return problem(route, 404, 'NOT_FOUND');
      if (rec[2]) {
        const key = req.headers()['idempotency-key'];
        if (decisions.has(key)) return json(route, decisions.get(key));
        r.status = body.decision === 'confirm' ? 'Executed' : 'Rejected';
        decisions.set(key, {...r});
      }
      return json(route, r, 200, r.version);
    }
    if (path === '/imports' && m === 'GET')
      return json(route, {items: jobs, nextCursor: null});
    if (path === '/imports' && m === 'POST') {
      const job: (typeof jobs)[number] = {
        ...jobs[0],
        id: 'imp-e2e',
        status: 'RECEIVING',
        fileName: body.fileName,
        totalRows: body.totalRows,
        received: 0,
        upserted: 0,
        rejected: 0,
        skipped: 0,
        rejects: [],
      };
      jobs.unshift(job);
      return json(route, job, 201);
    }
    const imp = /^\/imports\/([^/]+)(\/(mapping|batches|mapping-draft))?$/.exec(
      path,
    );
    if (imp) {
      const job = jobs.find(j => j.id === imp[1])!;
      if (imp[3] === 'mapping')
        return json(route, {...job, mapping: body.mapping});
      if (imp[3] === 'batches') {
        if (body.seq === 1 && failBatchOnce) {
          failBatchOnce = false;
          return problem(route, 503, 'UNAVAILABLE');
        }
        if (!batches.has(body.seq)) {
          job.received += body.rows.length;
          job.upserted += body.rows.length;
          if (body.last) job.status = 'DONE';
          batches.set(body.seq, {
            seq: body.seq,
            upserted: body.rows.length,
            skipped: 0,
            rejected: [],
            job: {
              status: job.status,
              received: job.received,
              upserted: job.upserted,
              skipped: 0,
              rejected: 0,
            },
          });
        }
        return json(route, batches.get(body.seq));
      }
      return json(route, job);
    }
    return problem(route, 404, 'NOT_FOUND');
  });
  return seen;
}

test.describe('business pages', () => {
  test('cockpit → object view → action → conflict dialog', async ({page}) => {
    const seen = await mockApi(page);
    await page.goto('/cockpit');
    await expect(page.getByRole('heading', {name: '态势总览'})).toBeVisible();
    await expect(page.getByRole('article', {name: '准时交付率'})).toBeVisible();
    await page.getByText('供应商 S-017 产能下降 60%').click();
    await expect(
      page.getByRole('heading', {name: '苏州精密零件有限公司'}),
    ).toBeVisible();

    await page.getByRole('button', {name: /执行动作/}).click();
    await page.getByRole('menuitem', {name: '暂停供应商'}).click();
    await page.getByRole('dialog').getByRole('button', {name: '执行'}).click();
    const exec = seen.find(s => s.path.endsWith('/executions'))!;
    expect(exec.headers['if-match']).toBe('"v14"');
    expect(exec.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);

    await page.getByRole('button', {name: '编辑'}).click();
    await page.getByLabel('country').fill('JP');
    await page.getByRole('button', {name: '保存'}).click();
    const dialog = page.getByRole('dialog', {name: '内容已在其他窗口修改'});
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', {name: '刷新并放弃我的修改'}).click();
    await expect(dialog).toBeHidden();
  });

  test('recommendation confirmation is idempotent', async ({page}) => {
    const seen = await mockApi(page);
    await page.goto('/recommendations/rec-203');
    await expect(
      page.getByText('PO-5530 切换至备选供应商 S-022').first(),
    ).toBeVisible();
    await page.getByRole('button', {name: '确认并执行'}).click();
    await page
      .getByRole('dialog')
      .getByRole('button', {name: /确认/})
      .last()
      .click();
    await expect(page.getByText('已执行').first()).toBeVisible();
    const decisions = seen.filter(
      s => s.path === '/recommendations/rec-203/decision',
    );
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(new Set(decisions.map(d => d.headers['idempotency-key'])).size).toBe(
      1,
    );
  });

  test('CSV import runs in sequential batches and retries a seq', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const seen = await mockApi(page);
    const header = 'supplierId,name,country,riskScore';
    const rows = Array.from(
      {length: 250},
      (_, i) => `S-${i},Vendor ${i},CN,${i % 100}`,
    );
    await page.goto('/imports/new');
    await page.getByText(/CSV/).first().click();
    const next = page.getByRole('button', {name: /下一步/});
    if (await next.isVisible()) await next.click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'vendors.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([header, ...rows].join('\n')),
    });
    for (let i = 0; i < 3; i++) {
      const n = page.getByRole('button', {name: /下一步/});
      if (await n.isEnabled()) await n.click();
    }
    await page.getByRole('button', {name: /开始导入|运行/}).click();
    await expect(page.getByText(/imp-e2e|完成|DONE/).first()).toBeVisible({
      timeout: 30_000,
    });
    const batches = seen.filter(s => s.path === '/imports/imp-e2e/batches');
    const seqs = batches.map(b => (b.body as {seq: number}).seq);
    expect(seqs).toEqual([0, 1, 1, 2]);
    expect(
      batches.every(b => (b.body as {rows: unknown[]}).rows.length <= 100),
    ).toBe(true);
    // the raw file is never uploaded
    expect(seen.some(s => typeof s.body === 'string')).toBe(false);
  });
});
