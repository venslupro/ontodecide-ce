/**
 * Typed HTTP transport for the OntoDecide Web app.
 *
 * Every resource module calls through the helpers here so there is one
 * place responsible for:
 *  - building the backend URL (Vite + Next compatible env lookup),
 *  - appending {@code Authorization: Bearer <token>} when a session accessor
 *    has been registered by the auth store,
 *  - translating network / 4xx-5xx responses into {@link ApiResponse<T>}
 *    objects that NEVER throw, letting callers rely on {@code .success}.
 */
import type { ApiError, ApiResponse } from '@ontodecide/shared';

/**
 * Shape exposed by the auth store so the transport can read tokens on
 * demand. Stored as a callback to avoid a circular import from the store.
 */
export interface SessionAccessor {
  tokens?: {
    accessToken?: string | undefined;
  } | null | undefined;
}

/** Module-scoped accessor reference; {@code null} until the app boots. */
export const sessionAccessorRef: {
  current: (() => SessionAccessor | null) | null;
} = { current: null };

/**
 * Registers the callback used by subsequent requests to read the current
 * access token. Called once during app bootstrap (e.g. zustand store init).
 *
 * @param fn Callback returning the current session snapshot or null.
 */
export function setSessionAccessor(
  fn: (() => SessionAccessor | null) | null,
): void {
  sessionAccessorRef.current = fn;
}

/**
 * Reads the configured backend base URL. Order of precedence:
 * 1. Vite runtime {@code import.meta.env.VITE_API_BASE},
 * 2. Node {@code process.env.VITE_API_BASE},
 * 3. Next-compatible {@code NEXT_PUBLIC_API_BASE}.
 * Defaults to the empty string so same-origin fetch is used in dev.
 *
 * @returns Base URL (without trailing slash) or the empty string.
 */
export function getApiBase(): string {
  const env: Record<string, string | undefined> = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env ?? {};
  const viteEnv = (
    globalThis as unknown as {
      import?: {
        meta?: { env?: Record<string, string | undefined> };
      };
    }
  ).import?.meta?.env;
  const viteBase = viteEnv?.VITE_API_BASE ?? env.VITE_API_BASE ?? '';
  if (viteBase) return viteBase.replace(/\/$/, '');
  const nextBase = env.NEXT_PUBLIC_API_BASE ?? '';
  return nextBase.replace(/\/$/, '');
}

/**
 * Performs a {@code GET} request and returns a typed {@link ApiResponse}.
 *
 * @param path Pathname (absolute, e.g. "/api/auth/login").
 * @param params Optional query parameters serialized via URLSearchParams.
 * @template T Expected payload type wrapped in the success envelope.
 */
export async function httpGet<T>(
  path: string,
  params?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  return execute<T>('GET', path, params, undefined);
}

/**
 * Performs a {@code POST} request with a JSON body.
 *
 * @param path Pathname.
 * @param body Body object serialized as JSON.
 * @template T Expected payload type wrapped in the success envelope.
 */
export async function httpPost<T>(
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  return execute<T>('POST', path, undefined, body);
}

/**
 * Performs a {@code PUT} request with a JSON body.
 *
 * @param path Pathname.
 * @param body Body object serialized as JSON.
 * @template T Expected payload type wrapped in the success envelope.
 */
export async function httpPut<T>(
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  return execute<T>('PUT', path, undefined, body);
}

/**
 * Performs a {@code DELETE} request. Optional params become the query
 * string (some callers use that instead of or in addition to path ids).
 *
 * @param path Pathname.
 * @param params Optional query parameters.
 * @template T Expected payload type wrapped in the success envelope.
 */
export async function httpDelete<T>(
  path: string,
  params?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  return execute<T>('DELETE', path, params, undefined);
}

/**
 * Shared implementation used by every HTTP verb.
 */
async function execute<T>(
  method: string,
  path: string,
  params: Record<string, unknown> | undefined,
  body: unknown,
): Promise<ApiResponse<T>> {
  try {
    const url = buildUrl(path, params);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const token = readAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(url.toString(), init);
    return parseResponse<T>(response);
  } catch (err) {
    return networkError<T>(err);
  }
}

/**
 * Reads the current access token from the registered session accessor.
 *
 * @returns A non-empty access token string, or {@code null} when there is
 *     no logged-in session.
 */
function readAccessToken(): string | null {
  const accessor = sessionAccessorRef.current;
  if (!accessor) return null;
  try {
    const session = accessor();
    const token = session?.tokens?.accessToken;
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Combines the base URL with {@code path} and serializes any query params.
 */
function buildUrl(
  path: string,
  params: Record<string, unknown> | undefined,
): string {
  const base = getApiBase();
  const fallbackOrigin = 'http://localhost/';
  const origin =
    typeof location !== 'undefined' ? location.href : fallbackOrigin;
  const url = new URL(base + path, origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, String(item)));
      } else {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return base
    ? url.toString()
    : url.pathname + url.search + url.hash;
}

/**
 * Parses a successful or failed fetch response into a normalized envelope.
 */
async function parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text();
  let json: unknown;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (response.ok) {
    return normalizeSuccess<T>(json);
  }
  return normalizeError(response.status, json);
}

/**
 * Builds an {@link ApiResponse<T>} for success responses. Backend payloads
 * that already expose {@code success}/{@code data}/{@code error} keys are
 * used directly; otherwise the JSON is wrapped as {@code {success:true,data}}.
 */
function normalizeSuccess<T>(json: unknown): ApiResponse<T> {
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (
      'success' in obj ||
      'data' in obj ||
      'error' in obj
    ) {
      return {
        success: typeof obj.success === 'boolean' ? obj.success : true,
        data: 'data' in obj ? (obj.data as T) : (json as T),
        error:
          'error' in obj && obj.error
            ? (obj.error as ApiError)
            : undefined,
        traceId: 'traceId' in obj ? String(obj.traceId ?? '') : undefined,
      } as ApiResponse<T>;
    }
  }
  return {
    success: true,
    data: json as T,
  };
}

/**
 * Builds an {@link ApiResponse<T>} for 4xx / 5xx responses. Attempts to
 * read the server's {@code error} payload first, falls back to a generic
 * HTTP_<status> code otherwise.
 */
function normalizeError<T>(
  status: number,
  json: unknown,
): ApiResponse<T> {
  let error: ApiError | undefined;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    const candidate =
      (obj.error as ApiError | undefined) ??
      (typeof (obj.code as unknown) === 'string'
        ? ((obj as unknown) as ApiError)
        : undefined);
    if (candidate && typeof candidate.code === 'string') {
      error = {
        code: candidate.code,
        message:
          typeof candidate.message === 'string'
            ? candidate.message
            : `HTTP ${status}`,
        details: candidate.details,
      };
    }
  }
  if (!error) {
    error = {
      code: `HTTP_${status}`,
      message: `HTTP ${status}`,
    };
  }
  const envelope: ApiResponse<T> = { success: false, error };
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if ('traceId' in obj) {
      envelope.traceId = String(obj.traceId ?? '');
    }
  }
  return envelope;
}

/**
 * Translates a thrown network failure into an {@link ApiResponse}.
 */
function networkError<T>(err: unknown): ApiResponse<T> {
  const message =
    err instanceof Error ? err.message : 'Network error occurred.';
  return {
    success: false,
    error: { code: 'NETWORK', message },
  };
}
