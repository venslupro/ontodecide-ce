#!/usr/bin/env node
/**
 * @fileoverview HTTP smoke test against a running stack (`pnpm dev`, or a
 * deployment via SMOKE_BASE_URL). Checks what is observable from outside
 * without reading e-mails:
 *
 *   1. GET /api/v1/health → 200
 *   2. GET /api/v1/openapi.yaml → 200, OpenAPI 3.2 document
 *   3. unknown route → 404 application/problem+json with code + traceId
 *   4. POST /auth/codes (signup) → 202
 *   5. refresh with a foreign Origin → 403 (Origin check)
 *   6. GET /me without a token → 401 UNAUTHENTICATED
 *
 * Pre-launch checks (详细设计 表 14 冒烟), from outside:
 *
 *   7. /api is served by the gateway Worker (Workers Route), not by Pages:
 *      the health response carries the gateway's `X-Request-Id`;
 *   8. CSP of the API response and of the SPA page contains
 *      `connect-src 'self'` (the SPA talks to no other backend);
 *   9. with SMOKE_PAGES_URL (e.g. https://ontodecide-ce.pages.dev, set when
 *      a custom domain is used): it answers 301 to SMOKE_BASE_URL.
 *
 * Not testable from here and therefore skipped: "the other 6 Workers have
 * no public URL" (their hostnames are unknown by construction), e-mail
 * link tracking, and B2 download headers (need a real archive).
 *
 * Transient edge errors (502–504, Cloudflare 520–527) are retried with
 * backoff: right after `wrangler pages deploy` the new Functions deployment
 * can answer 522 for a short while before it is live everywhere.
 *
 * SMOKE_READONLY=1 skips check 4 (it sends a real e-mail and needs the
 * Turnstile test secret) — used by the post-deploy smoke of production.
 *
 * Optional full flow when SMOKE_CODE_READER is set: a shell command that
 * prints the latest code for $SMOKE_EMAIL (e.g. a grep over the
 * identity-access log with EMAIL_MODE=log). It then signs up, reads /me and
 * loads the sample data.
 *
 *   SMOKE_BASE_URL   default http://127.0.0.1:8787 (gateway)
 *   SMOKE_ORIGIN     default http://localhost:5173 (must equal APP_ORIGIN)
 *   SMOKE_EMAIL      default smoke-<time>@example.com
 *   SMOKE_TURNSTILE  default XXXX.DUMMY.TOKEN.XXXX (always-pass test secret)
 */

import {execSync} from 'node:child_process';

const BASE = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8787').replace(
  /\/$/,
  '',
);
const API = `${BASE}/api/v1`;
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:5173';
const EMAIL = process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@example.com`;
const TURNSTILE = process.env.SMOKE_TURNSTILE ?? 'XXXX.DUMMY.TOKEN.XXXX';
const READONLY = process.env.SMOKE_READONLY === '1';
const PAGES_URL = (process.env.SMOKE_PAGES_URL ?? '').replace(/\/$/, '');

let failures = 0;

/** Statuses of a deployment that is not yet reachable at the edge. */
const TRANSIENT = new Set([
  502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527,
]);
const RETRY_DELAYS_S = [2, 5, 10, 20, 30];

/** fetch() that retries transient edge errors (see the file comment). */
async function fetchRetry(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    const delay = RETRY_DELAYS_S[attempt];
    if (!TRANSIENT.has(res.status) || delay === undefined) return res;
    await res.body?.cancel();
    console.log(`  … ${res.status} from ${url}, retrying in ${delay}s`);
    await new Promise(r => setTimeout(r, delay * 1000));
  }
}

/** Sends one request; returns {status, headers, text, json}. */
async function call(method, path, {body, headers = {}, token} = {}) {
  const res = await fetchRetry(API + path, {
    method,
    headers: {
      accept: 'application/json',
      'accept-language': 'en-US',
      origin: ORIGIN,
      ...(body === undefined ? {} : {'content-type': 'application/json'}),
      ...(token ? {authorization: `Bearer ${token}`} : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (openapi.yaml).
  }
  return {status: res.status, headers: res.headers, text, json};
}

/** Runs one named check; logs and counts failures. */
async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`✗ ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

/** Asserts a CSP header whose connect-src is exactly 'self'. */
function expectConnectSelf(csp) {
  expect(csp, 'no Content-Security-Policy header');
  const directive = csp
    .split(';')
    .map(d => d.trim())
    .find(d => d.startsWith('connect-src'));
  expect(directive === "connect-src 'self'", `connect-src: ${directive}`);
}

function expectProblem(r, status, code) {
  expect(r.status === status, `status ${r.status}, want ${status}: ${r.text}`);
  const type = r.headers.get('content-type') ?? '';
  expect(type.includes('application/problem+json'), `content-type ${type}`);
  if (code) expect(r.json?.code === code, `code ${r.json?.code}, want ${code}`);
  expect(typeof r.json?.traceId === 'string', 'traceId missing');
}

async function main() {
  console.log(`Smoke test against ${API} (Origin ${ORIGIN})`);

  await check('health', async () => {
    const r = await call('GET', '/health');
    expect(r.status === 200, `status ${r.status}`);
  });

  await check('/api served by the gateway Worker (X-Request-Id)', async () => {
    const r = await call('GET', '/health');
    expect(
      /^[\w-]{8,}$/.test(r.headers.get('x-request-id') ?? ''),
      `x-request-id ${r.headers.get('x-request-id')}`,
    );
  });

  await check("API CSP has connect-src 'self'", async () => {
    const r = await call('GET', '/health');
    expectConnectSelf(r.headers.get('content-security-policy'));
  });

  if (/^https:/.test(BASE)) {
    await check("SPA CSP has connect-src 'self'", async () => {
      const res = await fetchRetry(`${BASE}/`, {
        headers: {accept: 'text/html'},
      });
      expect(res.status === 200, `status ${res.status}`);
      expectConnectSelf(res.headers.get('content-security-policy'));
    });
  }

  if (PAGES_URL) {
    await check(`${PAGES_URL} → 301 ${BASE}`, async () => {
      const res = await fetchRetry(`${PAGES_URL}/login`, {redirect: 'manual'});
      expect(res.status === 301, `status ${res.status}`);
      const to = res.headers.get('location') ?? '';
      expect(to.startsWith(BASE), `location ${to}`);
    });
  }

  await check('openapi.yaml', async () => {
    const r = await call('GET', '/openapi.yaml', {
      headers: {accept: 'application/yaml'},
    });
    expect(r.status === 200, `status ${r.status}`);
    expect(/^openapi:\s*['"]?3\.2/m.test(r.text), 'not an OpenAPI 3.2 file');
  });

  await check('problem details on unknown route', async () => {
    expectProblem(await call('GET', '/no-such-route'), 404);
  });

  if (READONLY) {
    console.log('– sign-up code skipped (SMOKE_READONLY=1)');
  } else {
    await check('sign-up code accepted (202)', async () => {
      const r = await call('POST', '/auth/codes', {
        body: {
          email: EMAIL,
          purpose: 'signup',
          turnstileToken: TURNSTILE,
          locale: 'en-US',
        },
      });
      expect(r.status === 202, `status ${r.status}: ${r.text}`);
    });
  }

  await check('foreign Origin rejected (403)', async () => {
    const r = await call('POST', '/auth/sessions/refresh', {
      headers: {origin: 'https://evil.example'},
    });
    expectProblem(r, 403);
  });

  await check('/me without a token (401)', async () => {
    expectProblem(await call('GET', '/me'), 401, 'UNAUTHENTICATED');
  });

  const reader = process.env.SMOKE_CODE_READER;
  if (reader) await fullFlow(reader);
  else console.log('– full flow skipped (set SMOKE_CODE_READER)');

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nSmoke test passed');
}

/** Sign-up → /me → sample data, reading the code with `reader`. */
async function fullFlow(reader) {
  let token = '';
  await check('sign-up with the e-mailed code (201)', async () => {
    const code = execSync(reader, {env: {...process.env, SMOKE_EMAIL: EMAIL}})
      .toString()
      .trim();
    expect(/^\d{6}$/.test(code), `reader printed "${code}"`);
    const r = await call('POST', '/auth/sessions', {
      body: {email: EMAIL, code, purpose: 'signup'},
    });
    expect(r.status === 201, `status ${r.status}: ${r.text}`);
    token = r.json?.accessToken;
    expect(token, 'no accessToken');
  });
  if (!token) return;

  await check('GET /me (200)', async () => {
    const r = await call('GET', '/me', {token});
    expect(r.status === 200, `status ${r.status}: ${r.text}`);
  });

  await check('load sample data (202)', async () => {
    const r = await call('POST', '/workspace/sample-data', {token, body: {}});
    expect(r.status === 202, `status ${r.status}: ${r.text}`);
  });
}

await main();
