/**
 * @fileoverview Playwright helpers: API setup against the running dev stack
 * (same origin through the Vite proxy) and UI login.
 */

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, type APIRequestContext, type Page} from '@playwright/test';

/** Bootstrap admin credentials (created on first login against an empty DB). */
export const ADMIN = {
  email: process.env.E2E_EMAIL ?? 'admin@ontodecide.local',
  password: process.env.E2E_PASSWORD ?? 'Admin12345!',
};

const SAMPLES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../samples/supply-chain',
);

/** Reads a sample CSV into records. */
export function readSample(file: string): Record<string, string>[] {
  const [header, ...lines] = readFileSync(join(SAMPLES, file), 'utf8')
    .trim()
    .split('\n');
  const cols = header.split(',');
  return lines.map(l =>
    Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])),
  );
}

/** Absolute path of a sample file (for file inputs). */
export function samplePath(file: string): string {
  return join(SAMPLES, file);
}

/** Minimal API client using a bearer token obtained by logging in. */
export class Api {
  private constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  static async login(request: APIRequestContext): Promise<Api> {
    const res = await request.post('/api/v1/auth/login', {data: ADMIN});
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as {accessToken: string};
    return new Api(request, body.accessToken);
  }

  async call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.request.fetch(`/api/v1${path}`, {
      method,
      data,
      headers: {authorization: `Bearer ${this.token}`, ...headers},
    });
    expect(
      res.ok(),
      `${method} ${path}: ${res.status()} ${await res.text()}`,
    ).toBeTruthy();
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Polls until `fn` returns a truthy value. */
  async waitFor<T>(
    fn: () => Promise<T | null | undefined | false>,
    timeoutMs = 60_000,
  ): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - start > timeoutMs) throw new Error('timed out');
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

/** Logs in through the UI. */
export async function uiLogin(
  page: Page,
  redirect = '/cockpit',
): Promise<void> {
  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}&lang=zh-CN`);
  await page.getByLabel('邮箱').fill(ADMIN.email);
  await page.getByLabel('密码').fill(ADMIN.password);
  await page.getByRole('button', {name: '登录'}).click();
  await page.waitForURL(url => url.pathname.startsWith(redirect.split('?')[0]));
}
