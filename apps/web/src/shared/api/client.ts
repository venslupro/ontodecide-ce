/**
 * @fileoverview The only way the SPA talks to the backend: same-origin
 * `/api/v1` on api-gateway (前端详细设计 6.3.1). ESLint forbids `fetch`
 * outside `shared/api` and `shared/ws`.
 *
 * - Bearer access token from memory (never persisted).
 * - `X-Act-As-Tenant` while an admin is in the admin view.
 * - 401 UNAUTHENTICATED / TRIAL_EXPIRED → one single-flight refresh
 *   (`POST /auth/sessions/refresh`, cross-tab Web Lock), then one replay.
 *   If the refresh fails: TRIAL_EXPIRED (or a known past trial end) →
 *   `onTrialEnded` (→ /ended); otherwise `onAuthFailure` (→ /login).
 * - `If-Match` from a version number, `Idempotency-Key`, `X-Step-Up`.
 * - Problem Details → {@link ApiError}; the `Date` header estimates skew.
 */

import {
  ACT_AS_HEADER,
  IDEMPOTENCY_HEADER,
  STEP_UP_HEADER,
  parseEtag,
  toEtag,
} from '@ontodecide/shared-kernel';
import {ApiError, toApiError} from './errors';

/** API base path (same origin). */
export const API_BASE = '/api/v1';

/** Result of a refresh or login. */
export interface TokenGrant {
  accessToken: string;
  expiresIn: number;
}

/** Hooks the app installs so this module stays free of app state. */
export interface ApiHooks {
  getToken(): string | undefined;
  onToken(grant: TokenGrant): void;
  /** Session is gone (revoked, logged out elsewhere). */
  onAuthFailure(): void;
  /** The trial has ended (TRIAL_EXPIRED after a refresh attempt). */
  onTrialEnded(): void;
  /** Whether the locally known trial end has passed (corrected clock). */
  trialKnownExpired(): boolean;
  getLocale(): string;
  /** Act-as target tenant id (admin view), if any. */
  getActAs(): string | undefined;
  /** Server `Date` header, for clock skew estimation. */
  onServerDate(serverMs: number): void;
}

const hooks: ApiHooks = {
  getToken: () => undefined,
  onToken: () => {},
  onAuthFailure: () => {},
  onTrialEnded: () => {},
  trialKnownExpired: () => false,
  getLocale: () => 'zh-CN',
  getActAs: () => undefined,
  onServerDate: () => {},
};

/** Installs app hooks (token store, locale, redirects). */
export function configureApi(patch: Partial<ApiHooks>): void {
  Object.assign(hooks, patch);
}

/** Query parameter value. */
export type QueryValue = string | number | boolean | null | undefined;

/** Request options. */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Overrides `application/json` (e.g. `application/merge-patch+json`). */
  contentType?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** Resource version for If-Match (sent as `"v{n}"`). */
  ifMatch?: number;
  /** Passkey step-up token for high-risk admin writes. */
  stepUp?: string;
  /** Send the bearer token (default true). */
  auth?: boolean;
  /** Attempt refresh + replay on 401 (default true). */
  retryOn401?: boolean;
  /** Skip X-Act-As-Tenant even in the admin view. */
  noActAs?: boolean;
}

/** A parsed response with its version (ETag) when present. */
export interface ApiResult<T> {
  data: T;
  /** Version parsed from the ETag header, if any. */
  version: number | null;
  status: number;
}

/** Builds `/api/v1/<path>?query`. */
export function buildUrl(
  path: string,
  query?: Record<string, QueryValue>,
): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  let url = `${API_BASE}${p}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

/** Makes a same-origin path absolute (Node's fetch in tests needs it). */
export function absoluteUrl(url: string): string {
  const origin = globalThis.location?.origin;
  return origin && origin !== 'null' && url.startsWith('/')
    ? origin + url
    : url;
}

/** Web Locks name shared by every tab of this origin. */
export const REFRESH_LOCK = 'od-refresh';

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return fn();
  return locks.request(REFRESH_LOCK, fn) as Promise<T>;
}

/** Outcome of a refresh attempt. */
export type RefreshOutcome = 'ok' | 'expired' | 'unauthenticated';

let refreshing: Promise<RefreshOutcome> | null = null;

/**
 * Refreshes the access token using the HttpOnly cookie. Concurrent callers
 * in a tab share one request; tabs take turns via a Web Lock so the
 * rotating refresh token is never replayed.
 */
export function refreshAccessToken(): Promise<RefreshOutcome> {
  if (refreshing) return refreshing;
  const p = withRefreshLock(async (): Promise<RefreshOutcome> => {
    try {
      const res = await fetch(absoluteUrl(buildUrl('/auth/sessions/refresh')), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'accept-language': hooks.getLocale(),
        },
      });
      if (!res.ok) {
        const err = await toApiError(res);
        return err.code === 'TRIAL_EXPIRED' ? 'expired' : 'unauthenticated';
      }
      const grant = (await res.json()) as TokenGrant;
      if (!grant?.accessToken) return 'unauthenticated';
      hooks.onToken(grant);
      return 'ok';
    } catch {
      return 'unauthenticated';
    }
  });
  refreshing = p;
  void p.finally(() => {
    if (refreshing === p) refreshing = null;
  });
  return p;
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/');
}

async function send(
  path: string,
  opts: RequestOptions,
): Promise<{res: Response; token: string | undefined}> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-language': hooks.getLocale(),
    ...opts.headers,
  };
  const token = opts.auth === false ? undefined : hooks.getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const actAs = opts.noActAs ? undefined : hooks.getActAs();
  if (actAs && token) headers[ACT_AS_HEADER.toLowerCase()] = actAs;
  if (opts.idempotencyKey) {
    headers[IDEMPOTENCY_HEADER.toLowerCase()] = opts.idempotencyKey;
  }
  if (opts.ifMatch !== undefined) headers['if-match'] = toEtag(opts.ifMatch);
  if (opts.stepUp) headers[STEP_UP_HEADER.toLowerCase()] = opts.stepUp;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = opts.contentType ?? 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch(absoluteUrl(buildUrl(path, opts.query)), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
      credentials: 'same-origin',
    });
    const date = res.headers.get('date');
    if (date) {
      const ms = Date.parse(date);
      if (!Number.isNaN(ms)) hooks.onServerDate(ms);
    }
    return {res, token};
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError({code: 'ABORTED', status: 0});
    }
    throw new ApiError({
      code: 'NETWORK',
      status: 0,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Sends a request with auth recovery; returns the raw successful Response. */
export async function apiRaw(
  path: string,
  opts: RequestOptions = {},
): Promise<Response> {
  const first = await send(path, opts);
  let res = first.res;
  if (
    res.status === 401 &&
    opts.retryOn401 !== false &&
    opts.auth !== false &&
    !isAuthPath(path)
  ) {
    const err = await toApiError(res.clone());
    const current = hooks.getToken();
    // Another request may already have refreshed while this one was in
    // flight; replay directly with the new token in that case.
    const outcome: RefreshOutcome =
      current && current !== first.token ? 'ok' : await refreshAccessToken();
    if (outcome !== 'ok') {
      const ended =
        outcome === 'expired' ||
        err.code === 'TRIAL_EXPIRED' ||
        hooks.trialKnownExpired();
      if (ended) hooks.onTrialEnded();
      else hooks.onAuthFailure();
      throw err;
    }
    res = (await send(path, opts)).res;
    if (res.status === 401) {
      const again = await toApiError(res);
      if (again.code === 'TRIAL_EXPIRED') hooks.onTrialEnded();
      else hooks.onAuthFailure();
      throw again;
    }
  }
  if (!res.ok) throw await toApiError(res);
  return res;
}

/** Performs a request and returns the parsed body with its ETag version. */
export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiResult<T>> {
  const res = await apiRaw(path, opts);
  return {
    data: await parse<T>(res),
    version: parseEtag(res.headers.get('etag')),
    status: res.status,
  };
}

/** Performs a request and returns the parsed JSON body. */
export async function apiFetch<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  return (await apiRequest<T>(path, opts)).data;
}

type Opts = Omit<RequestOptions, 'method' | 'body'>;

/** Verb helpers. */
export const api = {
  get: <T>(path: string, opts?: Opts) =>
    apiFetch<T>(path, {...opts, method: 'GET'}),
  post: <T>(path: string, body?: unknown, opts?: Opts) =>
    apiFetch<T>(path, {...opts, method: 'POST', body}),
  put: <T>(path: string, body?: unknown, opts?: Opts) =>
    apiFetch<T>(path, {...opts, method: 'PUT', body}),
  patch: <T>(path: string, body?: unknown, opts?: Opts) =>
    apiFetch<T>(path, {...opts, method: 'PATCH', body}),
  del: <T = void>(path: string, body?: unknown, opts?: Opts) =>
    apiFetch<T>(path, {...opts, method: 'DELETE', body}),
};

/** Accepts either a bare array or `{items}` (list endpoints). */
export function asList<T>(value: T[] | {items?: T[]} | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value?.items ?? [];
}

/**
 * Generates an Idempotency-Key (UUID v7: time-ordered). Create it when the
 * user clicks; reuse it for network retries of the same operation.
 */
export function idempotencyKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const ts = Date.now();
  for (let i = 0; i < 6; i++) {
    bytes[i] = Math.floor(ts / 2 ** (8 * (5 - i))) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
