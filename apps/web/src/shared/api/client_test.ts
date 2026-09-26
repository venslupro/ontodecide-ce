/**
 * @fileoverview API client: headers, Problem Details mapping, single-flight
 * refresh on 401 with queued retries, auth failure redirect hook.
 */

import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {problem} from '../../test/handlers';
import {server} from '../../test/server';
import {
  api,
  asList,
  buildUrl,
  configureApi,
  refreshAccessToken,
} from './client';
import {ApiError, isApiError} from './errors';
import {retryDelay, shouldRetry} from './query_client';

let token: string | undefined;
const onAuthFailure = vi.fn();

beforeEach(() => {
  token = 'old';
  onAuthFailure.mockReset();
  configureApi({
    getToken: () => token,
    onToken: g => {
      token = g.accessToken;
    },
    getLocale: () => 'en-US',
    onAuthFailure,
  });
});

describe('api client', () => {
  it('sends bearer, Accept-Language, JSON body, If-Match and Idempotency-Key', async () => {
    let seen: Headers | undefined;
    let body: unknown;
    server.use(
      http.post('*/api/v1/echo', async ({request}) => {
        seen = request.headers;
        body = await request.json();
        return HttpResponse.json({ok: true});
      }),
    );
    const res = await api.post<{ok: boolean}>(
      '/echo',
      {a: 1},
      {ifMatch: 3, idempotencyKey: 'k:1'},
    );
    expect(res).toEqual({ok: true});
    expect(seen!.get('authorization')).toBe('Bearer old');
    expect(seen!.get('accept-language')).toBe('en-US');
    expect(seen!.get('content-type')).toBe('application/json');
    expect(seen!.get('if-match')).toBe('"3"');
    expect(seen!.get('idempotency-key')).toBe('k:1');
    expect(body).toEqual({a: 1});
  });

  it('builds URLs with query params, skipping empty values', () => {
    expect(
      buildUrl('/objects/Supplier', {
        limit: 50,
        cursor: undefined,
        q: '',
        filter: '{"op":"exists"}',
      }),
    ).toBe(
      '/api/v1/objects/Supplier?limit=50&filter=%7B%22op%22%3A%22exists%22%7D',
    );
  });

  it('maps Problem Details to ApiError with extras and Retry-After', async () => {
    server.use(
      http.get('*/api/v1/limited', () =>
        problem(429, 'RATE_LIMITED', 'slow down', {}, {'retry-after': '12'}),
      ),
      http.post('*/api/v1/pre', () =>
        problem(422, 'PRECONDITION_FAILED', 'unmet', {unmet: ['a', 'b']}),
      ),
    );
    const e1 = await api.get('/limited').catch(e => e as ApiError);
    expect(isApiError(e1, 'RATE_LIMITED')).toBe(true);
    expect(e1).toMatchObject({
      status: 429,
      retryAfter: 12,
      detail: 'slow down',
      requestId: 'req-test',
    });
    const e2 = await api.post('/pre').catch(e => e as ApiError);
    expect(e2).toMatchObject({code: 'PRECONDITION_FAILED', status: 422});
    expect((e2 as ApiError).extras.unmet).toEqual(['a', 'b']);
  });

  it('returns undefined for 204', async () => {
    server.use(
      http.delete(
        '*/api/v1/thing',
        () => new HttpResponse(null, {status: 204}),
      ),
    );
    await expect(api.del('/thing')).resolves.toBeUndefined();
  });

  it('maps network failures to NETWORK', async () => {
    server.use(http.get('*/api/v1/down', () => HttpResponse.error()));
    const e = await api.get('/down').catch(err => err as ApiError);
    expect(e).toMatchObject({code: 'NETWORK', status: 0});
  });

  it('refreshes once for concurrent 401s and replays every request', async () => {
    let refreshCalls = 0;
    server.use(
      http.post('*/api/v1/auth/refresh', async () => {
        refreshCalls += 1;
        await new Promise(r => setTimeout(r, 20));
        return HttpResponse.json({accessToken: 'new', expiresIn: 900});
      }),
      http.get('*/api/v1/secure/:n', ({request, params}) =>
        request.headers.get('authorization') === 'Bearer new'
          ? HttpResponse.json({n: Number(params.n)})
          : problem(401, 'AUTH_EXPIRED'),
      ),
    );
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(n => api.get<{n: number}>(`/secure/${n}`)),
    );
    expect(results.map(r => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(refreshCalls).toBe(1);
    expect(token).toBe('new');
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('replays without refreshing when another request already refreshed', async () => {
    let refreshCalls = 0;
    server.use(
      http.post('*/api/v1/auth/refresh', () => {
        refreshCalls += 1;
        return HttpResponse.json({accessToken: 'new', expiresIn: 900});
      }),
      http.get('*/api/v1/late', async ({request}) => {
        if (request.headers.get('authorization') === 'Bearer new')
          return HttpResponse.json({ok: 1});
        token = 'new'; // someone refreshed while this request was in flight
        return problem(401, 'AUTH_EXPIRED');
      }),
    );
    await expect(api.get('/late')).resolves.toEqual({ok: 1});
    expect(refreshCalls).toBe(0);
  });

  it('calls onAuthFailure when the refresh fails', async () => {
    server.use(
      http.post('*/api/v1/auth/refresh', () => problem(401, 'AUTH_EXPIRED')),
      http.get('*/api/v1/secure', () => problem(401, 'AUTH_EXPIRED')),
    );
    const e = await api.get('/secure').catch(err => err as ApiError);
    expect(e).toMatchObject({code: 'AUTH_EXPIRED', status: 401});
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for login failures', async () => {
    let refreshCalls = 0;
    server.use(
      http.post('*/api/v1/auth/refresh', () => {
        refreshCalls += 1;
        return HttpResponse.json({accessToken: 'x', expiresIn: 900});
      }),
    );
    await expect(
      api.post('/auth/login', {email: 'a@b.c', password: 'bad'}, {auth: false}),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
    expect(refreshCalls).toBe(0);
  });

  it('shares one refresh promise between direct callers', async () => {
    let calls = 0;
    server.use(
      http.post('*/api/v1/auth/refresh', () => {
        calls += 1;
        return HttpResponse.json({accessToken: 'r', expiresIn: 900});
      }),
    );
    const [a, b] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
    ]);
    expect(a && b).toBe(true);
    expect(calls).toBe(1);
  });

  it('accepts bare arrays or {items}', () => {
    expect(asList([1, 2])).toEqual([1, 2]);
    expect(asList({items: [3]})).toEqual([3]);
    expect(asList(undefined)).toEqual([]);
  });
});

describe('query retry policy', () => {
  it('does not retry 4xx, retries 5xx/network twice and honors Retry-After', () => {
    const e404 = new ApiError({code: 'NOT_FOUND', status: 404});
    const e500 = new ApiError({code: 'INTERNAL', status: 500});
    const e429 = new ApiError({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfter: 3,
    });
    expect(shouldRetry(0, e404)).toBe(false);
    expect(shouldRetry(0, e500)).toBe(true);
    expect(shouldRetry(2, e500)).toBe(false);
    expect(shouldRetry(0, e429)).toBe(true);
    expect(shouldRetry(1, e429)).toBe(false);
    expect(retryDelay(0, e429)).toBe(3000);
    expect(retryDelay(1, e500)).toBe(2000);
  });
});
