/**
 * @fileoverview Fetch wrapper for the same-origin `/api/v1` REST API.
 *
 * - Bearer access token from memory (never persisted).
 * - `Accept-Language` from the active UI language.
 * - Problem Details → {@link ApiError}.
 * - 401 → a single in-flight refresh shared by every concurrent request
 *   (the refresh cookie is HttpOnly), then each request is replayed once;
 *   if the refresh fails the app redirects to `/login?redirect=`.
 */

import {ApiError, toApiError} from './errors';

/** API base path (build-time constant, same origin). */
export const API_BASE = '/api/v1';

/** Result of a successful refresh / login. */
export interface TokenGrant {
  accessToken: string;
  expiresIn: number;
  user?: unknown;
}

/** Hooks the app installs so this module stays free of app state. */
export interface ApiHooks {
  getToken(): string | undefined;
  onToken(grant: TokenGrant): void;
  onAuthFailure(): void;
  getLocale(): string;
}

const hooks: ApiHooks = {
  getToken: () => undefined,
  onToken: () => {},
  onAuthFailure: () => {},
  getLocale: () => 'zh-CN',
};

/** Installs app hooks (token store, locale, auth failure handler). */
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
  headers?: Record<string, string>;
  signal?: AbortSignal;
  idempotencyKey?: string;
  ifMatch?: number | string;
  /** Send the bearer token (default true). */
  auth?: boolean;
  /** Attempt refresh + replay on 401 (default true). */
  retryOn401?: boolean;
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

let refreshing: Promise<boolean> | null = null;

/**
 * Refreshes the access token using the HttpOnly cookie. Concurrent callers
 * share one request (single-flight).
 */
export function refreshAccessToken(): Promise<boolean> {
  if (refreshing) return refreshing;
  const p = (async () => {
    try {
      const res = await fetch(absoluteUrl(buildUrl('/auth/refresh')), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'accept-language': hooks.getLocale(),
        },
      });
      if (!res.ok) return false;
      const grant = (await res.json()) as TokenGrant;
      if (!grant?.accessToken) return false;
      hooks.onToken(grant);
      return true;
    } catch {
      return false;
    }
  })();
  refreshing = p;
  void p.finally(() => {
    if (refreshing === p) refreshing = null;
  });
  return p;
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
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
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  if (opts.ifMatch !== undefined) headers['if-match'] = `"${opts.ifMatch}"`;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData || opts.body instanceof Blob) {
      body = opts.body;
    } else {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
  }
  try {
    const res = await fetch(absoluteUrl(buildUrl(path, opts.query)), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
      credentials: 'same-origin',
    });
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

/** Performs a request and returns the parsed JSON body. */
export async function apiFetch<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const first = await send(path, opts);
  let res = first.res;
  if (
    res.status === 401 &&
    opts.retryOn401 !== false &&
    opts.auth !== false &&
    !isAuthPath(path)
  ) {
    const current = hooks.getToken();
    // Another request may already have refreshed while this one was in
    // flight; replay directly with the new token in that case.
    const ok =
      current && current !== first.token ? true : await refreshAccessToken();
    if (!ok) {
      hooks.onAuthFailure();
      throw await toApiError(res);
    }
    res = (await send(path, opts)).res;
    if (res.status === 401) {
      hooks.onAuthFailure();
      throw await toApiError(res);
    }
  }
  if (!res.ok) throw await toApiError(res);
  return parse<T>(res);
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
  del: <T = void>(path: string, opts?: Opts) =>
    apiFetch<T>(path, {...opts, method: 'DELETE'}),
};

/** Accepts either a bare array or `{items}` (list endpoints). */
export function asList<T>(value: T[] | {items?: T[]} | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value?.items ?? [];
}

/** Generates an idempotency key. */
export function idempotencyKey(prefix = 'op'): string {
  const rnd =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}:${rnd}`;
}
