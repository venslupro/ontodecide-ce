/**
 * @fileoverview End-to-end tests of the gateway pipeline (middleware chain,
 * auth routes, protocol forwarding, BFF orchestrations) with fake service
 * bindings built from @ontodecide/testing.
 */

import type {DecisionRpc} from '@ontodecide/decision/contract';
import type {
  IdentityRpc,
  JwtClaims,
  TokenPair,
  UserDto,
} from '@ontodecide/identity/contract';
import type {IntegrationRpc} from '@ontodecide/integration/contract';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {
  CompiledModel,
  OntologyPack,
  OntologyRpc,
  PublishReport,
} from '@ontodecide/ontology/contract';
import {
  AppError,
  CTX_HEADER,
  decodeCtx,
  parseJwtKeys,
  signJwt,
  silentLogger,
  type CallCtx,
  type Logger,
  type Role,
  type UsageStatus,
} from '@ontodecide/shared-kernel';
import type {
  SituationOverview,
  SituationRpc,
} from '@ontodecide/situation/contract';
import {describe, expect, it, vi} from 'vitest';
// @ontodecide/testing is not a dependency of this worker package; tests
// import it by path.
import {
  FakeDoNamespace,
  MemoryKV,
  MemorySqlStorage,
  fetcherBinding,
  rpcBinding,
} from '@ontodecide/testing';
import {createApp, type GatewayApp} from './app';
import {EdgeGuardCore} from './edge_guard_core';
import type {Env} from './env';

// ---------------------------------------------------------------------------
// Harness

/** JWT secret used by tests. */
const TEST_JWT_SECRET = 'k1:test-secret-please-change';

/** Fixed test time. */
const TEST_NOW = Date.parse('2026-09-24T08:00:00Z');

/** Fake service implementations (any subset of each contract). */
interface FakeServices {
  identity?: Partial<IdentityRpc>;
  ontology?: Partial<OntologyRpc>;
  integration?: Partial<IntegrationRpc>;
  objects?: Partial<ObjectGraphRpc>;
  situation?: Partial<SituationRpc>;
  situationFetch?: (req: Request) => Promise<Response>;
  decision?: Partial<DecisionRpc>;
}

/** A usage status at the given level. */
function usageStatus(level: UsageStatus['level'] = 'ok'): UsageStatus {
  return {day: '2026-09-24', level, ratios: {}, used: {}};
}

/** Everything a gateway test needs. */
interface TestGateway {
  app: GatewayApp;
  env: Env;
  kv: MemoryKV;
  guard: FakeDoNamespace<EdgeGuardCore>;
  logs: {level: string; msg: string; fields?: Record<string, unknown>}[];
  now: {value: number};
}

/** Builds a gateway over fake services. */
function testGateway(
  services: FakeServices = {},
  extraEnv: Partial<Env> = {},
): TestGateway {
  const now = {value: TEST_NOW};
  const kv = new MemoryKV();
  const guard = new FakeDoNamespace(
    () => new EdgeGuardCore(new MemorySqlStorage(), () => now.value),
  );
  const situation: Partial<SituationRpc> = {
    recordUsage: async () => usageStatus('ok'),
    getUsage: async () => usageStatus('ok'),
    ...services.situation,
  };
  const env: Env = {
    IDENTITY: rpcBinding(services.identity ?? {}) as IdentityRpc,
    ONTOLOGY: rpcBinding(services.ontology ?? {}) as OntologyRpc,
    INTEGRATION: rpcBinding(services.integration ?? {}) as IntegrationRpc,
    OBJECTS: rpcBinding(services.objects ?? {}) as ObjectGraphRpc,
    SITUATION: fetcherBinding(
      services.situationFetch ??
        (async () => new Response('no stream', {status: 500})),
      situation,
    ) as SituationRpc & Fetcher,
    DECISION: rpcBinding(services.decision ?? {}) as DecisionRpc,
    EDGE_GUARD: guard.asNamespace(),
    CONFIG: kv.asKV(),
    JWT_SECRET: TEST_JWT_SECRET,
    APP_VERSION: '1.3.0-test',
    ...extraEnv,
  };
  const logs: TestGateway['logs'] = [];
  const logger: Logger = {
    ...silentLogger,
    log: (level, msg, fields) => logs.push({level, msg, fields}),
    info: (msg, fields) => logs.push({level: 'info', msg, fields}),
    warn: (msg, fields) => logs.push({level: 'warn', msg, fields}),
    error: (msg, fields) => logs.push({level: 'error', msg, fields}),
    child: () => logger,
  };
  const app = createApp(env, {now: () => now.value, logger});
  return {app, env, kv, guard, logs, now};
}

/** Mints an access token. */
async function testToken(
  role: Role = 'Admin',
  claims: Partial<JwtClaims> = {},
  secret = TEST_JWT_SECRET,
): Promise<string> {
  const iat = Math.floor(TEST_NOW / 1000);
  return signJwt(
    {
      sub: 'u1',
      tid: 't1',
      role,
      mk: [],
      iat,
      exp: iat + 900,
      jti: 'j1',
      ...claims,
    },
    parseJwtKeys(secret),
  );
}

/** Builds an API request. */
function apiRequest(
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
  let body: string | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set('content-type', 'application/json');
  }
  return new Request(`https://ontodecide-ce.pages.dev/api/v1${path}`, {
    method,
    headers,
    body,
  });
}

// ---------------------------------------------------------------------------
// Tests

const USER: UserDto = {
  id: 'u1',
  tenantId: 't1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'Admin',
  markings: [],
  disabled: false,
  locale: 'zh-CN',
  mustChangePassword: false,
  createdAt: '2026-09-01T00:00:00Z',
};

function pair(refreshToken = 'rt-1'): TokenPair {
  return {
    accessToken: 'at-1',
    expiresIn: 900,
    refreshToken,
    refreshExpiresAt: '2026-10-01T00:00:00Z',
    user: USER,
  };
}

describe('authentication', () => {
  it('rejects a missing token with a 401 problem', async () => {
    const {app} = testGateway({identity: {me: async () => USER}});
    const res = await app.fetch(apiRequest('GET', '/me'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({code: 'AUTH_INVALID', status: 401});
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('rejects a token signed with another key', async () => {
    const {app} = testGateway();
    const token = await testToken('Admin', {}, 'k1:wrong');
    const res = await app.fetch(apiRequest('GET', '/me', {token}));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({code: 'AUTH_INVALID'});
  });

  it('rejects an expired token with AUTH_EXPIRED', async () => {
    const {app} = testGateway();
    const token = await testToken('Admin', {
      exp: Math.floor(TEST_NOW / 1000) - 1,
    });
    const res = await app.fetch(apiRequest('GET', '/me', {token}));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({code: 'AUTH_EXPIRED'});
  });

  it('builds the CallCtx from claims and headers', async () => {
    const me = vi.fn(async (_ctx: CallCtx) => USER);
    const {app} = testGateway({identity: {me}});
    const token = await testToken('Operator', {
      sub: 'u7',
      tid: 't9',
      mk: ['PII'],
    });
    const res = await app.fetch(
      apiRequest('GET', '/me', {
        token,
        headers: {
          'x-request-id': 'req-abc',
          'x-correlation-id': 'corr-xyz',
          'accept-language': 'fr-FR, en-GB;q=0.8, zh;q=0.5',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('req-abc');
    expect(me.mock.calls[0][0]).toEqual({
      tenantId: 't9',
      userId: 'u7',
      roles: ['Operator'],
      markings: ['PII'],
      requestId: 'req-abc',
      correlationId: 'corr-xyz',
      locale: 'en-US',
    });
  });

  it('enforces the minimum role with 403 FORBIDDEN', async () => {
    const listUsers = vi.fn(async (..._args: unknown[]) => [USER]);
    const {app} = testGateway({identity: {listUsers}});
    const token = await testToken('Modeler');
    const res = await app.fetch(apiRequest('GET', '/users', {token}));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({code: 'FORBIDDEN'});
    expect(listUsers).not.toHaveBeenCalled();
    const ok = await app.fetch(
      apiRequest('GET', '/users', {token: await testToken('Admin')}),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([USER]);
  });
});

describe('errors and headers', () => {
  it('sets security headers on success and error responses', async () => {
    const {app} = testGateway();
    for (const path of ['/health', '/does-not-exist']) {
      const res = await app.fetch(apiRequest('GET', path));
      expect(res.headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(res.headers.get('strict-transport-security')).toContain(
        'max-age=',
      );
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-request-id')).toMatch(/^[0-9A-Z]{26}$/);
    }
  });

  it('returns 404 NOT_FOUND and 405 for unknown routes / methods', async () => {
    const {app} = testGateway();
    const nf = await app.fetch(apiRequest('GET', '/nope'));
    expect(nf.status).toBe(404);
    expect(await nf.json()).toMatchObject({code: 'NOT_FOUND'});
    const na = await app.fetch(apiRequest('DELETE', '/health'));
    expect(na.status).toBe(405);
    expect(na.headers.get('allow')).toBe('GET');
    const outside = await app.fetch(
      new Request('https://ontodecide-ce.pages.dev/other'),
    );
    expect(outside.status).toBe(404);
  });

  it('maps AppErrors thrown by a service across RPC', async () => {
    const {app} = testGateway({
      decision: {
        approve: async () => {
          throw new AppError('INVALID_TRANSITION', 'Already executed');
        },
      },
    });
    const token = await testToken('Operator');
    const res = await app.fetch(
      apiRequest('POST', '/recommendations/r1/approve', {token}),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_TRANSITION',
      detail: 'Already executed',
    });
  });

  it('hides unexpected error details behind 500 INTERNAL', async () => {
    const gw = testGateway({
      identity: {
        me: async () => {
          throw new Error('db password is hunter2');
        },
      },
    });
    const res = await gw.app.fetch(
      apiRequest('GET', '/me', {token: await testToken()}),
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('"code":"INTERNAL"');
    expect(text).not.toContain('hunter2');
    expect(gw.logs.some(l => l.msg === 'unhandled')).toBe(true);
  });

  it('maps OBJECT_NOT_FOUND when getObject returns null', async () => {
    const {app} = testGateway({objects: {getObject: async () => null}});
    const res = await app.fetch(
      apiRequest('GET', '/objects/rid/ri.t1.Supplier.1?expand=links&depth=2', {
        token: await testToken('Viewer'),
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({code: 'OBJECT_NOT_FOUND'});
  });

  it('logs one line per request with route and status', async () => {
    const gw = testGateway();
    await gw.app.fetch(apiRequest('GET', '/nope'));
    const line = gw.logs.find(l => l.msg === 'request');
    expect(line?.fields).toMatchObject({
      route: 'GET /nope',
      status: 404,
      durationMs: 0,
    });
    expect(line?.fields?.requestId).toBeDefined();
  });
});

describe('validation', () => {
  it('returns 400 with field errors for a bad body', async () => {
    const createUser = vi.fn();
    const {app} = testGateway({identity: {createUser}});
    const res = await app.fetch(
      apiRequest('POST', '/users', {
        token: await testToken(),
        body: {email: 'not-an-email', name: '', role: 'Root'},
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {code: string; errors: {path: string}[]};
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors.map(e => e.path).sort()).toEqual([
      'email',
      'name',
      'role',
    ]);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const {app} = testGateway();
    const res = await app.fetch(
      apiRequest('POST', '/auth/login', {rawBody: '{bad'}),
    );
    expect(res.status).toBe(400);
  });

  it('coerces query parameters', async () => {
    const listObjects = vi.fn(async (..._args: unknown[]) => ({
      items: [],
      nextCursor: null,
    }));
    const {app} = testGateway({objects: {listObjects}});
    const filter = encodeURIComponent(
      JSON.stringify({op: 'gte', prop: 'riskScore', value: 70}),
    );
    const res = await app.fetch(
      apiRequest(
        'GET',
        `/objects/Supplier?filter=${filter}&orderBy=riskScore:desc&limit=20`,
        {token: await testToken('Viewer')},
      ),
    );
    expect(res.status).toBe(200);
    expect(listObjects.mock.calls[0]).toEqual([
      expect.anything(),
      'Supplier',
      {
        filter: {op: 'gte', prop: 'riskScore', value: 70},
        orderBy: [{prop: 'riskScore', dir: 'desc'}],
        cursor: undefined,
        limit: 20,
      },
    ]);
    const bad = await app.fetch(
      apiRequest('GET', '/objects/Supplier?limit=500', {
        token: await testToken('Viewer'),
      }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      errors: [{path: 'limit'}],
    });
  });

  it('passes If-Match as ifMatch to applyAction', async () => {
    const applyAction = vi.fn(async (..._args: unknown[]) => ({ok: true}));
    const {app} = testGateway({objects: {applyAction} as never});
    const res = await app.fetch(
      apiRequest('POST', '/actions/switchSupplier/apply', {
        token: await testToken('Operator'),
        headers: {'if-match': '"7"'},
        body: {target: 'ri.t1.Material.1', params: {newSupplier: 'x'}},
      }),
    );
    expect(res.status).toBe(200);
    expect(applyAction.mock.calls[0][1]).toEqual({
      actionType: 'switchSupplier',
      target: 'ri.t1.Material.1',
      params: {newSupplier: 'x'},
      recommendationId: undefined,
      ifMatch: 7,
    });
  });
});

describe('auth routes', () => {
  it('login sets the HttpOnly refresh cookie and hides the refresh token', async () => {
    const login = vi.fn(async (..._args: unknown[]) => pair('secret-refresh'));
    const {app} = testGateway({identity: {login}});
    const res = await app.fetch(
      apiRequest('POST', '/auth/login', {
        body: {email: 'admin@example.com', password: 'pw'},
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('secret-refresh');
    expect(JSON.parse(body)).toEqual({
      accessToken: 'at-1',
      expiresIn: 900,
      user: USER,
    });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('od_refresh=secret-refresh');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('Max-Age=604800');
  });

  it('omits Secure when COOKIE_SECURE is "false"', async () => {
    const {app} = testGateway(
      {identity: {login: async () => pair()}},
      {COOKIE_SECURE: 'false'},
    );
    const res = await app.fetch(
      apiRequest('POST', '/auth/login', {
        body: {email: 'admin@example.com', password: 'pw'},
      }),
    );
    expect(res.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('refresh requires the cookie and rotates it', async () => {
    const refresh = vi.fn(async (..._args: unknown[]) => pair('rt-2'));
    const {app} = testGateway({identity: {refresh}});
    const missing = await app.fetch(apiRequest('POST', '/auth/refresh'));
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({code: 'AUTH_INVALID'});

    const res = await app.fetch(
      apiRequest('POST', '/auth/refresh', {
        headers: {cookie: 'theme=dark; od_refresh=rt-1'},
      }),
    );
    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledWith('rt-1');
    expect(res.headers.get('set-cookie')).toContain('od_refresh=rt-2');
    expect(await res.text()).not.toContain('rt-2');
  });

  it('refresh clears the cookie when identity rejects it', async () => {
    const {app} = testGateway({
      identity: {
        refresh: async () => {
          throw new AppError('AUTH_INVALID', 'Replay detected');
        },
      },
    });
    const res = await app.fetch(
      apiRequest('POST', '/auth/refresh', {headers: {cookie: 'od_refresh=x'}}),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('logout revokes and clears the cookie', async () => {
    const logout = vi.fn(async (..._args: unknown[]) => undefined);
    const {app} = testGateway({identity: {logout}});
    const res = await app.fetch(
      apiRequest('POST', '/auth/logout', {
        headers: {cookie: 'od_refresh=rt-9'},
      }),
    );
    expect(res.status).toBe(204);
    expect(logout).toHaveBeenCalledWith('rt-9');
    expect(res.headers.get('set-cookie')).toMatch(/^od_refresh=; .*Max-Age=0/);
  });

  it('limits login attempts per client IP', async () => {
    const {app} = testGateway({identity: {login: async () => pair()}});
    const attempt = (ip: string) =>
      app.fetch(
        apiRequest('POST', '/auth/login', {
          headers: {'cf-connecting-ip': ip},
          body: {email: 'a@example.com', password: 'x'},
        }),
      );
    for (let i = 0; i < 10; i++)
      expect((await attempt('1.1.1.1')).status).toBe(200);
    const blocked = await attempt('1.1.1.1');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await attempt('2.2.2.2')).status).toBe(200);
  });
});

describe('idempotency', () => {
  it('replays the stored response without calling the service again', async () => {
    const submitBatch = vi.fn(async (..._args: unknown[]) => ({
      jobId: 'j1',
      queuedMessages: 2,
    }));
    const gw = testGateway({integration: {submitBatch}});
    const token = await testToken('Operator');
    const send = () =>
      gw.app.fetch(
        apiRequest('POST', '/sources/s1/batches', {
          token,
          headers: {'idempotency-key': 'batch-0001'},
          body: {seq: 0, last: true, records: [{id: 1}]},
        }),
      );
    const first = await send();
    expect(first.status).toBe(202);
    expect(first.headers.get('idempotent-replay')).toBeNull();
    const second = await send();
    expect(second.status).toBe(202);
    expect(second.headers.get('idempotent-replay')).toBe('true');
    expect(await second.json()).toEqual({jobId: 'j1', queuedMessages: 2});
    expect(submitBatch).toHaveBeenCalledTimes(1);
    // Sharded per tenant.
    expect([...gw.guard.instances.keys()]).toEqual(['t1']);
  });

  it('does not store failed responses', async () => {
    let calls = 0;
    const {app} = testGateway({
      decision: {
        approve: async () => {
          calls++;
          if (calls === 1) throw new AppError('UPSTREAM_FAILED');
          return {id: 'r1'} as never;
        },
      },
    });
    const token = await testToken('Operator');
    const send = () =>
      app.fetch(
        apiRequest('POST', '/recommendations/r1/approve', {
          token,
          headers: {'idempotency-key': 'k1'},
        }),
      );
    expect((await send()).status).toBe(502);
    expect((await send()).status).toBe(200);
    expect(calls).toBe(2);
  });
});

describe('rate limiting and quota', () => {
  it('returns 429 with Retry-After when the bucket is empty', async () => {
    const gw = testGateway({ontology: {listSchemas: async () => []}});
    const token = await testToken('Viewer');
    for (let i = 0; i < 60; i++) {
      const r = await gw.app.fetch(
        apiRequest('GET', '/ontology/schemas', {token}),
      );
      expect(r.status).toBe(200);
    }
    const res = await gw.app.fetch(
      apiRequest('GET', '/ontology/schemas', {token}),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('1');
    expect(await res.json()).toMatchObject({code: 'RATE_LIMITED'});
    gw.now.value += 2000;
    const again = await gw.app.fetch(
      apiRequest('GET', '/ontology/schemas', {token}),
    );
    expect(again.status).toBe(200);
  });

  it('limits webhooks per source', async () => {
    const acceptWebhook = vi.fn(async (..._args: unknown[]) => ({
      accepted: 1,
      jobId: 'j',
    }));
    const {app} = testGateway({integration: {acceptWebhook}});
    const hit = (src: string) =>
      app.fetch(apiRequest('POST', `/ingest/webhook/${src}`, {rawBody: '{}'}));
    for (let i = 0; i < 60; i++) expect((await hit('s1')).status).toBe(202);
    expect((await hit('s1')).status).toBe(429);
    expect((await hit('s2')).status).toBe(202);
  });

  it('rejects non-critical writes at quota stop but lets approvals and reads pass', async () => {
    const getUsage = vi.fn(async (..._args: unknown[]) => usageStatus('stop'));
    const {app} = testGateway({
      situation: {getUsage, listKpis: async () => []},
      integration: {submitBatch: async () => ({jobId: 'j', queuedMessages: 1})},
      decision: {approve: async () => ({id: 'r1'}) as never},
    });
    const token = await testToken('Operator');
    const write = await app.fetch(
      apiRequest('POST', '/sources/s1/batches', {
        token,
        body: {seq: 0, last: true, records: [{a: 1}]},
      }),
    );
    expect(write.status).toBe(503);
    expect(await write.json()).toMatchObject({code: 'QUOTA_EXCEEDED'});
    const approve = await app.fetch(
      apiRequest('POST', '/recommendations/r1/approve', {token}),
    );
    expect(approve.status).toBe(200);
    const read = await app.fetch(apiRequest('GET', '/kpis', {token}));
    expect(read.status).toBe(200);
    // Cached for 30 s.
    await app.fetch(
      apiRequest('POST', '/sources/s1/batches', {
        token,
        body: {seq: 1, last: true, records: [{a: 1}]},
      }),
    );
    expect(getUsage).toHaveBeenCalledTimes(1);
  });

  it('fails open when SITUATION is unreachable', async () => {
    const {app} = testGateway({
      situation: {
        getUsage: async () => {
          throw new Error('down');
        },
      },
      integration: {submitBatch: async () => ({jobId: 'j', queuedMessages: 1})},
    });
    const res = await app.fetch(
      apiRequest('POST', '/sources/s1/batches', {
        token: await testToken('Operator'),
        body: {seq: 0, last: true, records: [{a: 1}]},
      }),
    );
    expect(res.status).toBe(202);
  });

  it('reports usage to SITUATION.recordUsage (3 invocations per request)', async () => {
    const recordUsage = vi.fn(async (..._args: unknown[]) => usageStatus('ok'));
    const gw = testGateway({situation: {recordUsage}});
    await gw.app.fetch(apiRequest('GET', '/health'));
    await gw.app.fetch(apiRequest('GET', '/health'));
    await gw.app.flushUsage();
    expect(recordUsage).toHaveBeenCalledWith([
      {resource: 'workers.requests', n: 6},
    ]);
  });
});

describe('protocol forwarding', () => {
  it('forwards the WebSocket upgrade with x-od-ctx', async () => {
    let forwarded: Request | undefined;
    const upstream = new Response('upgraded', {status: 200});
    const {app} = testGateway({
      situationFetch: async req => {
        forwarded = req;
        return upstream;
      },
    });
    const token = await testToken('Viewer');
    const res = await app.fetch(
      apiRequest('GET', `/situation/stream?access_token=${token}&lastSeq=5`, {
        headers: {upgrade: 'websocket'},
      }),
    );
    expect(await res.text()).toBe('upgraded');
    expect(forwarded).toBeDefined();
    const ctx = decodeCtx(forwarded!.headers.get(CTX_HEADER)!);
    expect(ctx).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      roles: ['Viewer'],
    });
    expect(forwarded!.headers.get('upgrade')).toBe('websocket');
    const url = new URL(forwarded!.url);
    expect(url.searchParams.get('access_token')).toBeNull();
    expect(url.searchParams.get('lastSeq')).toBe('5');
  });

  it('rejects the stream without a token', async () => {
    const {app} = testGateway();
    const res = await app.fetch(
      apiRequest('GET', '/situation/stream', {headers: {upgrade: 'websocket'}}),
    );
    expect(res.status).toBe(401);
  });

  it('passes the raw webhook body and lower-cased signature headers', async () => {
    const acceptWebhook = vi.fn(async (..._args: unknown[]) => ({
      accepted: 2,
      jobId: 'j1',
    }));
    const {app} = testGateway({integration: {acceptWebhook}});
    const raw = '{"records":[{"id":1},{"id":2}]}';
    const res = await app.fetch(
      apiRequest('POST', '/ingest/webhook/src-1', {
        rawBody: raw,
        headers: {
          'X-OD-Signature': 'abc123',
          'X-OD-Timestamp': '1790000000',
          'Content-Type': 'application/json',
          'X-Other': 'ignored',
        },
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({accepted: 2, jobId: 'j1'});
    expect(acceptWebhook).toHaveBeenCalledWith(
      'src-1',
      {
        'x-od-signature': 'abc123',
        'x-od-timestamp': '1790000000',
        'content-type': 'application/json',
      },
      raw,
    );
  });

  it('rejects webhook bodies over 1 MB with 413', async () => {
    const {app} = testGateway({integration: {acceptWebhook: vi.fn()}});
    const res = await app.fetch(
      apiRequest('POST', '/ingest/webhook/s1', {
        rawBody: 'x'.repeat(1024 * 1024 + 1),
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({code: 'BATCH_TOO_LARGE'});
  });
});

describe('gateway endpoints', () => {
  it('GET /config merges KV flags over defaults', async () => {
    const gw = testGateway();
    await gw.kv.put('features', JSON.stringify({neo4j: true, beta: 1}));
    const res = await gw.app.fetch(apiRequest('GET', '/config'));
    expect(await res.json()).toEqual({
      features: {
        neo4j: true,
        aiMapping: true,
        darkTheme: true,
        wallMode: true,
        beta: 1,
      },
      version: '1.3.0-test',
    });
  });

  it('GET /health and /openapi.json are public', async () => {
    const {app} = testGateway();
    const health = await app.fetch(apiRequest('GET', '/health'));
    expect(await health.json()).toEqual({status: 'ok', version: '1.3.0-test'});
    const doc = await app.fetch(apiRequest('GET', '/openapi.json'));
    expect(doc.status).toBe(200);
    expect(await doc.json()).toMatchObject({openapi: '3.1.0'});
  });

  it('POST /telemetry logs events and returns 204', async () => {
    const gw = testGateway();
    const res = await gw.app.fetch(
      apiRequest('POST', '/telemetry', {
        body: [
          {type: 'error', message: 'boom'},
          {type: 'vital', name: 'LCP', value: 1200},
        ],
      }),
    );
    expect(res.status).toBe(204);
    const lines = gw.logs.filter(l => l.msg === 'telemetry');
    expect(lines).toHaveLength(2);
    expect(lines[1].fields?.event).toEqual({
      type: 'vital',
      name: 'LCP',
      value: 1200,
    });
  });

  it('POST /telemetry rejects bodies over 16 KB', async () => {
    const {app} = testGateway();
    const res = await app.fetch(
      apiRequest('POST', '/telemetry', {
        body: {type: 'error', message: 'x'.repeat(17 * 1024)},
      }),
    );
    expect(res.status).toBe(413);
  });
});

function report(breaking: boolean): PublishReport {
  return {
    apiName: 'supply',
    version: breaking ? '2.0.0' : '1.1.0',
    diff: {
      apiName: 'supply',
      fromVersion: '1.0.0',
      toVersion: breaking ? '2.0.0' : '1.1.0',
      breaking,
      changes: breaking
        ? [
            {
              kind: 'propertyRemoved',
              path: 'objectTypes.Supplier.properties.rating',
              breaking: true,
            },
            {
              kind: 'objectTypeRemoved',
              path: 'objectTypes.Plant',
              breaking: true,
            },
            {
              kind: 'propertyAdded',
              path: 'objectTypes.Material.properties.x',
              breaking: false,
            },
          ]
        : [
            {
              kind: 'propertyAdded',
              path: 'objectTypes.Material.properties.x',
              breaking: false,
            },
          ],
      suggestedVersion: breaking ? '2.0.0' : '1.1.0',
    },
    indexChanges: [],
    publishedAt: '2026-09-24T08:00:00Z',
  };
}

describe('BFF', () => {
  it('overview merges situation and data health', async () => {
    const overview: SituationOverview = {
      kpis: [],
      alerts: [],
      usage: usageStatus('ok'),
      recommendations: [],
      generatedAt: '2026-09-24T08:00:00Z',
    };
    const {app} = testGateway({
      situation: {overview: async () => overview},
      integration: {dataHealth: async () => [{sourceId: 's1'}] as never},
    });
    const res = await app.fetch(
      apiRequest('GET', '/situation/overview', {
        token: await testToken('Viewer'),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...overview,
      dataHealth: [{sourceId: 's1'}],
    });
  });

  it('overview degrades when data health fails', async () => {
    const {app} = testGateway({
      situation: {overview: async () => ({kpis: []}) as never},
      integration: {
        dataHealth: async () => {
          throw new Error('down');
        },
      },
    });
    const res = await app.fetch(
      apiRequest('GET', '/situation/overview', {
        token: await testToken('Viewer'),
      }),
    );
    expect(await res.json()).toEqual({
      kpis: [],
      dataHealth: [],
      degraded: true,
    });
  });

  it('publish reindexes and does not pause sources for additive changes', async () => {
    const onOntologyPublished = vi.fn(async (..._args: unknown[]) => ({
      reindexed: 3,
    }));
    const pauseSourcesForTypes = vi.fn(async (..._args: unknown[]) => ({
      paused: 0,
    }));
    const publish = vi.fn(async (..._args: unknown[]) => report(false));
    const {app} = testGateway({
      ontology: {publish},
      objects: {onOntologyPublished},
      integration: {pauseSourcesForTypes},
    });
    const res = await app.fetch(
      apiRequest('POST', '/ontology/schemas/supply/publish', {
        token: await testToken('Modeler'),
      }),
    );
    expect(res.status).toBe(200);
    expect(publish.mock.calls[0].slice(1)).toEqual(['supply', {}]);
    expect(onOntologyPublished.mock.calls[0][1]).toEqual({
      api: 'supply',
      version: '1.1.0',
      breaking: false,
    });
    expect(pauseSourcesForTypes).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({reindexed: 3, pausedSources: 0});
  });

  it('publish pauses sources of the broken object types', async () => {
    const pauseSourcesForTypes = vi.fn(async (..._args: unknown[]) => ({
      paused: 2,
    }));
    const {app} = testGateway({
      ontology: {publish: async () => report(true)},
      objects: {onOntologyPublished: async () => ({reindexed: 1})},
      integration: {pauseSourcesForTypes},
    });
    const res = await app.fetch(
      apiRequest('POST', '/ontology/schemas/supply/publish', {
        token: await testToken('Modeler'),
        body: {confirmVersion: '2.0.0'},
      }),
    );
    expect(pauseSourcesForTypes.mock.calls[0][1]).toEqual([
      'Supplier',
      'Plant',
    ]);
    expect(await res.json()).toMatchObject({
      pausedSources: 2,
      version: '2.0.0',
    });
  });

  it('packs:import installs the pack content', async () => {
    const pack: OntologyPack = {
      id: 'supply-chain',
      name: 'Supply chain',
      version: '1.0.0',
      schema: {} as never,
      automations: [{name: 'High risk'}],
      kpis: [{name: 'Risky suppliers'}],
    };
    const installPackContent = vi.fn(async (..._args: unknown[]) => ({
      automations: 1,
      kpis: 1,
    }));
    const importPack = vi.fn(async (..._args: unknown[]) => ({
      report: report(false),
      pack,
    }));
    const {app} = testGateway({
      ontology: {importPack},
      objects: {onOntologyPublished: async () => ({reindexed: 0})},
      situation: {installPackContent},
    });
    const res = await app.fetch(
      apiRequest('POST', '/ontology/packs:import', {
        token: await testToken('Modeler'),
        body: {packId: 'supply-chain'},
      }),
    );
    expect(res.status).toBe(200);
    expect(importPack.mock.calls[0][1]).toEqual({packId: 'supply-chain'});
    expect(installPackContent.mock.calls[0][1]).toEqual({
      automations: [{name: 'High risk'}],
      kpis: [{name: 'Risky suppliers'}],
    });
    expect(await res.json()).toMatchObject({
      pack: {id: 'supply-chain'},
      installed: {automations: 1, kpis: 1},
    });
  });

  it('packs:import requires packId or pack', async () => {
    const {app} = testGateway();
    const res = await app.fetch(
      apiRequest('POST', '/ontology/packs:import', {
        token: await testToken('Modeler'),
        body: {},
      }),
    );
    expect(res.status).toBe(400);
  });

  it('mapping:suggest passes targetProps from the active model', async () => {
    const model = {
      objectTypes: {
        Supplier: {
          properties: [
            {
              apiName: 'name',
              dataType: 'string',
              displayName: {'zh-CN': '名称', 'en-US': 'Name'},
            },
            {apiName: 'riskScore', dataType: 'double', displayName: '风险分'},
          ],
        },
      },
    } as unknown as CompiledModel;
    const suggestMapping = vi.fn(
      async (..._args: unknown[]) => ({mapping: {}}) as never,
    );
    const {app} = testGateway({
      ontology: {getActiveModel: async () => model},
      decision: {suggestMapping},
    });
    const res = await app.fetch(
      apiRequest('POST', '/sources/s1/mapping:suggest', {
        token: await testToken('Modeler'),
        headers: {'accept-language': 'en-US'},
        body: {fields: ['n', 'r'], rows: [['A', 1]], targetType: 'Supplier'},
      }),
    );
    expect(res.status).toBe(200);
    expect(suggestMapping.mock.calls[0][1]).toEqual({
      fields: ['n', 'r'],
      rows: [['A', 1]],
      targetType: 'Supplier',
      targetProps: [
        {apiName: 'name', dataType: 'string', displayName: 'Name'},
        {apiName: 'riskScore', dataType: 'double', displayName: '风险分'},
      ],
    });
    const unknown = await app.fetch(
      apiRequest('POST', '/sources/s1/mapping:suggest', {
        token: await testToken('Modeler'),
        body: {fields: ['n'], rows: [], targetType: 'Nope'},
      }),
    );
    expect(unknown.status).toBe(400);
  });
});
