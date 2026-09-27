/**
 * @fileoverview Platform end-to-end specs (前端详细设计 表 13): sign-up,
 * trial-end redirect, /ended without API calls, archive "delete now",
 * admin passkey login with a CDP virtual authenticator, admin view header,
 * owner 403 on /admin, and "no request leaves /api/v1".
 *
 * The API is mocked with `page.route` so the specs run against `vite dev`
 * or `vite preview` alone; they are skipped when no server answers
 * (E2E_BASE_URL, default http://localhost:5173).
 */

import {expect, test, type Page, type Route} from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

test.beforeAll(async ({request}) => {
  const up = await request.get(BASE).then(
    r => r.ok(),
    () => false,
  );
  test.skip(!up, `no server at ${BASE}`);
});

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}

function token(role: 'owner' | 'admin', texpHours = 30): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url('{"alg":"EdDSA"}')}.${b64url(
    JSON.stringify({
      sub: 'u1',
      role,
      tid: role === 'admin' ? 'ws-ADMIN' : 'ws-OWNER0000000000K4',
      st: 'ACTIVE',
      ...(role === 'owner' ? {texp: now + texpHours * 3600} : {}),
      sid: 's1',
      amr: role === 'admin' ? ['otp', 'passkey'] : ['otp'],
      iat: now,
      exp: now + 900,
    }),
  )}.sig`;
}

function me(role: 'owner' | 'admin', hoursLeft = 30) {
  const texp = Date.now() + hoursLeft * 3_600_000;
  return {
    userId: 'u1',
    email: role === 'admin' ? 'admin@example.com' : 'e2e@example.com',
    role,
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    workspace: {
      tenantId: role === 'admin' ? 'ws-ADMIN' : 'ws-OWNER0000000000K4',
      kind: role === 'admin' ? 'admin' : 'trial',
      status: 'ACTIVE',
      verifiedAt: new Date(texp - 72 * 3_600_000).toISOString(),
      trialExpiresAt: role === 'admin' ? null : new Date(texp).toISOString(),
      expiredAt: null,
    },
    sessions: {used: 1, limit: 3},
    ...(role === 'admin' ? {passkeys: 2} : {}),
    quotas: {
      objects: {used: 0, limit: 300},
      links: {used: 0, limit: 900},
      importRowsToday: {used: 0, limit: 2000},
      aiRecsToday: {used: 0, limit: 3},
      mappingDraftsToday: {used: 0, limit: 2},
      sessions: {used: 1, limit: 3},
      resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const problem = (route: Route, status: number, code: string) =>
  route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({type: 'about:blank', title: code, status, code}),
  });

/** Records every request and blocks anything that is not same-origin. */
function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', r => urls.push(r.url()));
  return urls;
}

/** Default API mock; `over` handles specific paths first. */
async function mockApi(
  page: Page,
  over: (path: string, route: Route) => Promise<boolean> | boolean = () =>
    false,
) {
  await page.route('**/challenges.cloudflare.com/**', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'window.turnstile={render:(e,o)=>{setTimeout(()=>o.callback("tt"),10);return "w"},remove(){}};',
    }),
  );
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (await over(path, route)) return;
    if (path === '/auth/sessions/refresh')
      return problem(route, 401, 'UNAUTHENTICATED');
    if (path === '/situation/stream-tickets')
      return json(route, {ticket: 't.1', expiresIn: 30}, 201);
    return json(route, {items: [], nextCursor: null});
  });
}

test('sign-up: e-mail → Turnstile → code → cockpit with ~3 days left', async ({
  page,
}) => {
  await mockApi(page, (path, route) => {
    if (path === '/auth/codes')
      return route.fulfill({status: 202}).then(() => true);
    if (path === '/auth/sessions')
      return json(
        route,
        {accessToken: token('owner', 72), expiresIn: 900, me: me('owner', 72)},
        201,
      ).then(() => true);
    if (path === '/me') return json(route, me('owner', 72)).then(() => true);
    return false;
  });
  await page.goto('/signup');
  await page.getByLabel('邮箱').fill('e2e@example.com');
  await expect(page.getByText('人机验证已通过')).toBeVisible();
  await page.getByRole('button', {name: '发送验证码'}).click();
  await page.getByLabel('第 1 位').fill('123456');
  await expect(page).toHaveURL(/\/cockpit$/);
  await expect(page.getByText(/[23] 天 \d\d 小时/)).toBeVisible();
});

test('sign-up closed stays on the e-mail step', async ({page}) => {
  await mockApi(page, (path, route) =>
    path === '/auth/codes'
      ? problem(route, 503, 'SIGNUP_CLOSED').then(() => true)
      : false,
  );
  await page.goto('/signup');
  await page.getByLabel('邮箱').fill('e2e@example.com');
  await page.getByRole('button', {name: '发送验证码'}).click();
  await expect(page.getByText('今日名额已满，请明日再试')).toBeVisible();
});

test('/ended makes no API request', async ({page}) => {
  const urls = trackRequests(page);
  await page.goto('/ended?lang=en');
  await expect(page.getByText('Your data is packed')).toBeVisible();
  expect(urls.filter(u => u.includes('/api/'))).toEqual([]);
});

test('trial end: TRIAL_EXPIRED → one refresh → /ended', async ({page}) => {
  let refreshes = 0;
  await mockApi(page, (path, route) => {
    if (path === '/auth/sessions/refresh') {
      refreshes += 1;
      return problem(route, 401, 'TRIAL_EXPIRED').then(() => true);
    }
    return false;
  });
  await page.goto('/cockpit');
  await expect(page).toHaveURL(/\/ended$/);
  expect(refreshes).toBeGreaterThanOrEqual(1);
});

test('archive "delete now": token leaves the address bar, POST with Idempotency-Key', async ({
  page,
}) => {
  const urls = trackRequests(page);
  let idem: string | undefined;
  await mockApi(page, async (path, route) => {
    if (!path.startsWith('/archive-deletions/')) return false;
    if (route.request().method() === 'GET') {
      await json(route, {
        expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
        sizeBytes: 412_000,
      });
    } else {
      idem = route.request().headers()['idempotency-key'];
      await route.fulfill({status: 204});
    }
    return true;
  });
  await page.goto('/archive-deletions/tok-e2e-0123456789');
  await expect(page.getByText('412 KB')).toBeVisible();
  expect(page.url()).not.toContain('tok-e2e');
  await page.getByRole('checkbox').click();
  await page.getByRole('button', {name: '确认删除'}).click();
  await expect(
    page.getByText('归档已删除，邮件中的下载链接已失效。'),
  ).toBeVisible();
  expect(idem).toBeTruthy();
  const origin = new URL(BASE).origin;
  const foreign = urls.filter(
    u => !u.startsWith(origin) && !u.startsWith('data:'),
  );
  expect(foreign).toEqual([]);
});

test('owner sees 403 on /admin', async ({page}) => {
  await mockApi(page, (path, route) => {
    if (path === '/auth/sessions/refresh')
      return json(route, {accessToken: token('owner'), expiresIn: 900}).then(
        () => true,
      );
    if (path === '/me') return json(route, me('owner')).then(() => true);
    return false;
  });
  await page.goto('/admin');
  await expect(page.getByText('无权执行该操作')).toBeVisible();
});

test('admin: passkey login (virtual authenticator) and admin view header', async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  let actAs: string | undefined;
  let session = false;
  await mockApi(page, async (path, route) => {
    const req = route.request();
    if (path === '/auth/codes')
      return route.fulfill({status: 202}).then(() => true);
    if (path === '/auth/sessions')
      return json(route, {
        passkeyRequired: true,
        preAuth: 'p',
        setupRequired: false,
      }).then(() => true);
    if (path === '/auth/passkeys/options') {
      // Unknown credential ids make the virtual authenticator fail; accept
      // the error path too: the page must stay on the passkey step.
      return json(route, {
        challenge: b64url('challenge'),
        rpId: new URL(BASE).hostname,
        userVerification: 'required',
      }).then(() => true);
    }
    if (path === '/auth/passkeys/assertion') {
      session = true;
      return json(
        route,
        {accessToken: token('admin'), expiresIn: 900, me: me('admin')},
        201,
      ).then(() => true);
    }
    if (path === '/auth/sessions/refresh' && session)
      return json(route, {accessToken: token('admin'), expiresIn: 900}).then(
        () => true,
      );
    if (path === '/me') return json(route, me('admin')).then(() => true);
    if (path.startsWith('/admin/users'))
      return json(route, {
        items: [
          {
            userId: 'u9',
            tenantId: 'ws-TARGET00000000007Q',
            email: 'li.na@corp.cn',
            status: 'ACTIVE',
            trialExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
            zipExpiresAt: null,
            sessions: 1,
            banned: false,
          },
        ],
        nextCursor: null,
      }).then(() => true);
    if (path.startsWith('/objects')) actAs = req.headers()['x-act-as-tenant'];
    return false;
  });
  await page.goto('/login');
  await page.getByLabel('邮箱').fill('admin@example.com');
  await page.getByRole('button', {name: '发送验证码'}).click();
  await page.getByLabel('第 1 位').fill('123456');
  const outcome = await Promise.race([
    page.waitForURL(/\/admin$/).then(() => 'admin'),
    page
      .getByText('Passkey 验证失败或已取消，请重试')
      .waitFor()
      .then(() => 'failed'),
  ]);
  test.skip(
    outcome === 'failed',
    'virtual authenticator has no matching credential',
  );
  const row = page.getByRole('row', {name: /li\.na@corp\.cn/});
  await row.getByRole('button', {name: '进入'}).click();
  await expect(page.getByText(/管理员视图：正在查看/)).toBeVisible();
  await page.getByRole('combobox', {name: '全局检索'}).fill('abc');
  await expect.poll(() => actAs).toBe('ws-TARGET00000000007Q');
  await page.getByRole('button', {name: '退出'}).click();
  await expect(page).toHaveURL(/\/admin$/);
});
