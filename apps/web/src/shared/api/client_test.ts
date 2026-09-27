/**
 * @fileoverview API client (V2.4): headers (bearer, Accept-Language,
 * If-Match, Idempotency-Key, X-Step-Up, X-Act-As-Tenant), Problem Details,
 * ETag versions, single-flight refresh, and the TRIAL_EXPIRED paths
 * (refresh once first; /ended only when the refresh fails too).
 */

import {http, HttpResponse} from 'msw';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {problem} from '../../test/handlers';
import {server} from '../../test/server';
import {
  api,
  apiRequest,
  asList,
  buildUrl,
  configureApi,
  idempotencyKey,
  refreshAccessToken,
} from './client';
import {ApiError, isApiError} from './errors';
import {retryDelay, shouldRetry} from './query_client';

let token: string | undefined;
let actAs: string | undefined;
let knownExpired = false;
const onAuthFailure = vi.fn();
const onTrialEnded = vi.fn();
const onServerDate = vi.fn();

beforeEach(() => {
  token = 'old';
  actAs = undefined;
  knownExpired = false;
  onAuthFailure.mockReset();
  onTrialEnded.mockReset();
  onServerDate.mockReset();
  configureApi({
    getToken: () => token,
    onToken: g => {
      token = g.accessToken;
    },
    getLocale: () => 'en-US',
    getActAs: () => actAs,
    trialKnownExpired: () => knownExpired,
    onAuthFailure,
    onTrialEnded,
    onServerDate,
  });
});

function refreshOk(counter?: {n: number}) {
  return http.post('*/api/v1/auth/sessions/refresh', () => {
    if (counter) counter.n += 1;
    return HttpResponse.json({accessToken: 'new', expiresIn: 900});
  });
}

describe('api client headers', () => {
  it('sends bearer, language, If-Match, Idempotency-Key, X-Step-Up, act-as', async () => {
    let seen: Headers | undefined;
    let body: unknown;
    server.use(
      http.post('*/api/v1/echo', async ({request}) => {
        seen = request.headers;
        body = await request.json();
        return HttpResponse.json(
          {ok: true},
          {headers: {date: 'Mon, 28 Sep 2026 12:00:00 GMT'}},
        );
      }),
    );
    actAs = 'ws-target';
    const res = await api.post<{ok: boolean}>(
      '/echo',
      {a: 1},
      {ifMatch: 3, idempotencyKey: 'k-0123456789abcdef', stepUp: 'su'},
    );
    expect(res).toEqual({ok: true});
    expect(seen!.get('authorization')).toBe('Bearer old');
    expect(seen!.get('accept-language')).toBe('en-US');
    expect(seen!.get('if-match')).toBe('"v3"');
    expect(seen!.get('idempotency-key')).toBe('k-0123456789abcdef');
    expect(seen!.get('x-step-up')).toBe('su');
    expect(seen!.get('x-act-as-tenant')).toBe('ws-target');
    expect(body).toEqual({a: 1});
    expect(onServerDate).toHaveBeenCalledWith(
      Date.parse('2026-09-28T12:00:00Z'),
    );
  });

  it('omits X-Act-As-Tenant with noActAs and without a token', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/api/v1/echo', ({request}) => {
        seen.push(request.headers.get('x-act-as-tenant'));
        return HttpResponse.json({});
      }),
    );
    actAs = 'ws-target';
    await api.get('/echo', {noActAs: true});
    token = undefined;
    await api.get('/echo', {auth: false});
    expect(seen).toEqual([null, null]);
  });

  it('returns the ETag version with apiRequest', async () => {
    server.use(
      http.get('*/api/v1/thing', () =>
        HttpResponse.json({x: 1}, {headers: {etag: '"v7"'}}),
      ),
    );
    const r = await apiRequest<{x: number}>('/thing');
    expect(r).toMatchObject({data: {x: 1}, version: 7, status: 200});
  });

  it('builds URLs, skipping empty values', () => {
    expect(buildUrl('/objects', {limit: 50, cursor: undefined, q: ''})).toBe(
      '/api/v1/objects?limit=50',
    );
  });

  it('generates UUIDv7 idempotency keys', () => {
    const a = idempotencyKey();
    const b = idempotencyKey();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(a).not.toBe(b);
  });

  it('accepts list shapes', () => {
    expect(asList([1])).toEqual([1]);
    expect(asList({items: [2]})).toEqual([2]);
    expect(asList(null)).toEqual([]);
  });
});

describe('Problem Details', () => {
  it('maps code, extras, traceId and Retry-After', async () => {
    server.use(
      http.get('*/api/v1/limited', () =>
        problem(
          429,
          'RATE_LIMITED',
          'slow',
          {what: 'x'},
          {'retry-after': '12'},
        ),
      ),
    );
    const err = await api.get('/limited').catch(e => e as ApiError);
    expect(isApiError(err, 'RATE_LIMITED')).toBe(true);
    expect(err).toMatchObject({
      status: 429,
      retryAfter: 12,
      traceId: 'trace-test',
    });
    expect((err as ApiError).extras).toEqual({what: 'x'});
  });

  it('maps network failures to NETWORK', async () => {
    server.use(http.get('*/api/v1/down', () => HttpResponse.error()));
    const err = await api.get('/down').catch(e => e as ApiError);
    expect(isApiError(err, 'NETWORK')).toBe(true);
  });

  it('retries GETs on 5xx twice, never on 4xx or QUOTA_EXCEEDED beyond one', () => {
    const e500 = new ApiError({code: 'INTERNAL', status: 500});
    const e404 = new ApiError({code: 'NOT_FOUND', status: 404});
    expect(shouldRetry(0, e500)).toBe(true);
    expect(shouldRetry(2, e500)).toBe(false);
    expect(shouldRetry(0, e404)).toBe(false);
    expect(
      retryDelay(
        0,
        new ApiError({code: 'RATE_LIMITED', status: 429, retryAfter: 3}),
      ),
    ).toBe(3000);
  });
});

describe('refresh on 401', () => {
  it('refreshes once for concurrent 401s and replays each request', async () => {
    const counter = {n: 0};
    server.use(
      refreshOk(counter),
      http.get('*/api/v1/data/:id', ({request, params}) =>
        request.headers.get('authorization') === 'Bearer new'
          ? HttpResponse.json({id: params.id})
          : problem(401, 'UNAUTHENTICATED'),
      ),
    );
    const results = await Promise.all([
      api.get<{id: string}>('/data/1'),
      api.get<{id: string}>('/data/2'),
      api.get<{id: string}>('/data/3'),
    ]);
    expect(results.map(r => r.id)).toEqual(['1', '2', '3']);
    expect(counter.n).toBe(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('goes to login when the refresh fails (UNAUTHENTICATED)', async () => {
    server.use(
      http.post('*/api/v1/auth/sessions/refresh', () =>
        problem(401, 'UNAUTHENTICATED'),
      ),
      http.get('*/api/v1/data', () => problem(401, 'UNAUTHENTICATED')),
    );
    await expect(api.get('/data')).rejects.toBeInstanceOf(ApiError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(onTrialEnded).not.toHaveBeenCalled();
  });

  it('does not refresh for /auth/* paths', async () => {
    const counter = {n: 0};
    server.use(
      refreshOk(counter),
      http.post('*/api/v1/auth/sessions', () =>
        problem(401, 'UNAUTHENTICATED'),
      ),
    );
    await expect(api.post('/auth/sessions', {})).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(counter.n).toBe(0);
  });

  it('shares one refresh between callers (single flight)', async () => {
    const counter = {n: 0};
    server.use(refreshOk(counter));
    const [a, b] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
    ]);
    expect([a, b]).toEqual(['ok', 'ok']);
    expect(counter.n).toBe(1);
  });
});

describe('TRIAL_EXPIRED (V2.4 #1)', () => {
  it('refreshes first; a successful refresh (trial extended) replays and stays', async () => {
    server.use(
      refreshOk(),
      http.get('*/api/v1/data', ({request}) =>
        request.headers.get('authorization') === 'Bearer new'
          ? HttpResponse.json({ok: 1})
          : problem(401, 'TRIAL_EXPIRED'),
      ),
    );
    await expect(api.get('/data')).resolves.toEqual({ok: 1});
    expect(onTrialEnded).not.toHaveBeenCalled();
  });

  it('goes to /ended when the refresh also says TRIAL_EXPIRED', async () => {
    server.use(
      http.post('*/api/v1/auth/sessions/refresh', () =>
        problem(401, 'TRIAL_EXPIRED'),
      ),
      http.get('*/api/v1/data', () => problem(401, 'TRIAL_EXPIRED')),
    );
    await expect(api.get('/data')).rejects.toBeInstanceOf(ApiError);
    expect(onTrialEnded).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('account gone (refresh UNAUTHENTICATED): /ended if the trial is known expired', async () => {
    server.use(
      http.post('*/api/v1/auth/sessions/refresh', () =>
        problem(401, 'UNAUTHENTICATED'),
      ),
      http.get('*/api/v1/data', () => problem(401, 'UNAUTHENTICATED')),
    );
    knownExpired = true;
    await expect(api.get('/data')).rejects.toBeInstanceOf(ApiError);
    expect(onTrialEnded).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('replay still TRIAL_EXPIRED after a good refresh → /ended', async () => {
    server.use(
      refreshOk(),
      http.get('*/api/v1/data', () => problem(401, 'TRIAL_EXPIRED')),
    );
    await expect(api.get('/data')).rejects.toBeInstanceOf(ApiError);
    expect(onTrialEnded).toHaveBeenCalledTimes(1);
  });
});
