/**
 * @fileoverview Tests of each stage of the gateway chain (详细设计 6.11.7,
 * 表 14 安全用例): requestId, security headers, body limit, route match,
 * Origin, Ed25519 verification (UNAUTHENTICATED vs TRIAL_EXPIRED), admin
 * session revocation, scope, Act-as (targets, cache, audit ordering), rate
 * limits, validation, required headers and Problem Details.
 */

import {AppError, ERROR_CODES, type CallCtx} from '@ontodecide/shared-kernel';
import {TEST_TID, TEST_UID} from '@ontodecide/testing';
import {describe, expect, it, vi} from 'vitest';
import {
  ADMIN_TID,
  ADMIN_UID,
  TARGET_TID,
  adminToken,
  call,
  makeGateway,
  mintToken,
  ownerToken,
  problemOf,
  sampleMe,
  untrustedKey,
} from './harness_test';
import {CSP} from './middleware/security_headers';

const RID = 'ri.Supplier.01K6A00000000000000000R001';

function objectDto(version = 3) {
  return {
    rid: RID,
    type: 'Supplier',
    primaryKey: 'S1',
    title: 'S1',
    props: {},
    provenance: {},
    version,
    updatedAt: '2026-09-24T08:00:00Z',
  };
}

describe('requestId and security headers', () => {
  it('echoes a well-formed X-Request-Id and uses it as traceId', async () => {
    const gw = await makeGateway();
    const res = await call(gw, 'GET', '/nope', {
      headers: {'x-request-id': 'req-abcdef12'},
    });
    expect(res.headers.get('x-request-id')).toBe('req-abcdef12');
    expect((await problemOf(res)).traceId).toBe('req-abcdef12');
  });

  it('generates a ULID when the header is missing or malformed', async () => {
    const gw = await makeGateway();
    const res = await call(gw, 'GET', '/health', {
      headers: {'x-request-id': 'bad id with spaces'},
    });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('sets the security headers on success and on errors', async () => {
    const gw = await makeGateway();
    for (const res of [
      await call(gw, 'GET', '/health'),
      await call(gw, 'GET', '/me'),
    ]) {
      expect(res.headers.get('content-security-policy')).toBe(CSP);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(res.headers.get('strict-transport-security')).toContain(
        'max-age=',
      );
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(CSP).toContain("connect-src 'self'");
    expect(CSP).toContain('https://challenges.cloudflare.com');
    expect(CSP).toContain("frame-ancestors 'none'");
  });
});

describe('body limit', () => {
  it('rejects a declared oversize body with 413 VALIDATION_FAILED', async () => {
    const gw = await makeGateway({}, {env: {MAX_BODY_BYTES: '100'}});
    const res = await call(gw, 'POST', '/auth/codes', {
      rawBody: 'x'.repeat(101),
    });
    expect(res.status).toBe(413);
    expect((await problemOf(res)).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an oversize streamed body without Content-Length', async () => {
    const gw = await makeGateway({}, {env: {MAX_BODY_BYTES: '1000'}});
    const chunk = new TextEncoder().encode('y'.repeat(600));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(chunk);
        c.enqueue(chunk);
        c.close();
      },
    });
    const req = new Request(
      'https://ontodecide-ce.example.com/api/v1/auth/codes',
      {
        method: 'POST',
        headers: {
          origin: 'https://ontodecide-ce.example.com',
          'content-type': 'application/json',
        },
        body,
        duplex: 'half',
      } as RequestInit,
    );
    const res = await gw.app.fetch(req);
    expect(res.status).toBe(413);
  });

  it('uses 512 KB by default', async () => {
    const gw = await makeGateway({}, {env: {MAX_BODY_BYTES: undefined}});
    const res = await call(gw, 'POST', '/auth/codes', {
      rawBody: 'x'.repeat(512 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });
});

describe('route match', () => {
  it('answers 404 NOT_FOUND for unknown paths and methods', async () => {
    const gw = await makeGateway();
    const a = await call(gw, 'GET', '/unknown');
    expect(a.status).toBe(404);
    expect((await problemOf(a)).code).toBe('NOT_FOUND');
    const b = await call(gw, 'PUT', '/health');
    expect(b.status).toBe(404);
    const c = await gw.app.fetch(
      new Request('https://ontodecide-ce.example.com/other'),
    );
    expect(c.status).toBe(404);
    expect(c.headers.get('content-security-policy')).toBe(CSP);
  });
});

describe('Origin', () => {
  it('rejects writes without or with a foreign Origin (403)', async () => {
    const sendCode = vi.fn(async () => undefined);
    const gw = await makeGateway({identity: {sendCode}});
    const body = {
      email: 'a@example.com',
      purpose: 'signup',
      turnstileToken: 't',
    };
    const missing = await call(gw, 'POST', '/auth/codes', {
      body,
      origin: false,
    });
    expect(missing.status).toBe(403);
    expect((await problemOf(missing)).code).toBe('FORBIDDEN');
    const foreign = await call(gw, 'POST', '/auth/codes', {
      body,
      origin: 'https://evil.example',
    });
    expect(foreign.status).toBe(403);
    expect(sendCode).not.toHaveBeenCalled();
    const good = await call(gw, 'POST', '/auth/codes', {body});
    expect(good.status).toBe(202);
  });

  it('does not require Origin on GET', async () => {
    const gw = await makeGateway({identity: {getMe: async () => sampleMe()}});
    const res = await call(gw, 'GET', '/me', {
      token: await ownerToken(),
      origin: false,
    });
    expect(res.status).toBe(200);
  });

  it('requires Origin on refresh', async () => {
    const gw = await makeGateway();
    const res = await call(gw, 'POST', '/auth/sessions/refresh', {
      origin: false,
      headers: {cookie: '__Host-od_rt=abc'},
    });
    expect(res.status).toBe(403);
  });
});

describe('token verification', () => {
  const me = {identity: {getMe: async () => sampleMe()}};

  it('401 UNAUTHENTICATED without a token', async () => {
    const gw = await makeGateway(me);
    const res = await call(gw, 'GET', '/me');
    expect(res.status).toBe(401);
    expect((await problemOf(res)).code).toBe('UNAUTHENTICATED');
  });

  it('401 UNAUTHENTICATED for bad signature, malformed and expired tokens', async () => {
    const gw = await makeGateway(me);
    const tokens = [
      await mintToken({key: await untrustedKey()}),
      'not.a.jwt',
      await ownerToken({expIn: 0}),
    ];
    for (const token of tokens) {
      const res = await call(gw, 'GET', '/me', {token});
      expect(res.status).toBe(401);
      expect((await problemOf(res)).code).toBe('UNAUTHENTICATED');
    }
  });

  it('401 TRIAL_EXPIRED when texp ≤ now or st ≠ ACTIVE', async () => {
    const gw = await makeGateway(me);
    for (const token of [
      await ownerToken({texpIn: 0}),
      await ownerToken({st: 'EXPIRED'}),
      await ownerToken({st: 'ARCHIVING'}),
    ]) {
      const res = await call(gw, 'GET', '/me', {token});
      expect(res.status).toBe(401);
      expect((await problemOf(res)).code).toBe('TRIAL_EXPIRED');
    }
  });

  it('never treats the admin as trial-expired', async () => {
    const gw = await makeGateway({
      identity: {getMe: async () => sampleMe('admin')},
    });
    const res = await call(gw, 'GET', '/me', {token: await adminToken()});
    expect(res.status).toBe(200);
  });

  it('lets an owner whose trial ended log out', async () => {
    const logout = vi.fn(async () => undefined);
    const gw = await makeGateway({identity: {logout}});
    const res = await call(gw, 'DELETE', '/auth/sessions/current', {
      token: await ownerToken({texpIn: -60, st: 'EXPIRED'}),
    });
    expect(res.status).toBe(204);
    expect(logout).toHaveBeenCalledOnce();
  });
});

/** A fake adminSessionStatus. */
function status(
  o: Partial<{
    valid: boolean;
    recoveryPending: boolean;
    setupIncomplete: boolean;
  }> = {},
) {
  return async () => ({
    valid: true,
    recoveryPending: false,
    setupIncomplete: false,
    ...o,
  });
}

describe('admin session', () => {
  it('checks adminSessionStatus on every admin request (revocation is immediate)', async () => {
    let live = true;
    const verify = vi.fn(async (sid: string) => ({
      valid: live && sid === 'sid-a',
      recoveryPending: false,
      setupIncomplete: false,
    }));
    const gw = await makeGateway({
      identity: {
        adminSessionStatus: verify,
        adminOverview: async () => ({}) as never,
      },
    });
    const token = await adminToken({sid: 'sid-a'});
    expect((await call(gw, 'GET', '/admin/overview', {token})).status).toBe(
      200,
    );
    live = false;
    const res = await call(gw, 'GET', '/admin/overview', {token});
    expect(res.status).toBe(401);
    expect((await problemOf(res)).code).toBe('UNAUTHENTICATED');
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('is not called for owner tokens', async () => {
    const verify = vi.fn(status());
    const gw = await makeGateway({
      identity: {adminSessionStatus: verify, getMe: async () => sampleMe()},
    });
    await call(gw, 'GET', '/me', {token: await ownerToken()});
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('admin session gate', () => {
  const ok = async () => ({}) as never;
  const identity = {
    getMe: async () => sampleMe('admin'),
    usage: async () => [],
    logout: async () => undefined,
    adminOverview: ok,
    adminListUsers: ok,
    adminListPasskeys: async () => [],
    adminPasskeyOptions: async () => ({challenge: 'c'}),
    adminAddPasskey: async () => ({passkey: {}, total: 3}) as never,
    adminDeletePasskey: async () => undefined,
    adminGetSettings: ok,
    passkeyOptions: async () => ({challenge: 'c'}),
  };
  const objects = {
    stats: async () => ({objects: 0, links: 0, byType: {}}),
    listObjects: async () => ({items: [], nextCursor: null}),
  };
  const recoveryToken = () => adminToken({amr: ['otp', 'recovery']});

  async function reason(res: Response): Promise<string | undefined> {
    return ((await res.json()) as {reason?: string}).reason;
  }

  it('recovery pending: only /me, the passkey list/options/registration and logout', async () => {
    const gw = await makeGateway({
      identity: {
        ...identity,
        adminSessionStatus: status({recoveryPending: true}),
      },
      objects,
    });
    const token = await recoveryToken();
    const allowed: [string, string, unknown?][] = [
      ['GET', '/me'],
      ['GET', '/admin/passkeys'],
      ['POST', '/admin/passkeys/options', {}],
      ['POST', '/admin/passkeys', {credential: {id: 'c'}}],
      ['DELETE', '/auth/sessions/current'],
    ];
    for (const [m, p, body] of allowed) {
      const res = await call(gw, m, p, {token, body});
      expect(res.status, `${m} ${p}`).toBeLessThan(300);
    }
    const denied: [string, string, Record<string, string>?, unknown?][] = [
      ['GET', '/admin/overview'],
      ['GET', '/admin/users'],
      ['GET', '/admin/settings'],
      ['DELETE', '/admin/passkeys/pk1', {'x-step-up': 's'}],
      ['POST', '/auth/passkeys/options', {}, {purpose: 'step_up'}],
      ['GET', '/objects'],
      ['GET', '/objects', {'x-act-as-tenant': TARGET_TID}],
      ['GET', '/me', {'x-act-as-tenant': TARGET_TID}],
    ];
    for (const [m, p, headers, body] of denied) {
      const res = await call(gw, m, p, {token, headers, body});
      expect(res.status, `${m} ${p}`).toBe(403);
      expect(await reason(res)).toBe('RECOVERY_PENDING');
    }
  });

  it('decides by the session state: an upgraded recovery token has full access', async () => {
    const gw = await makeGateway({identity, objects});
    const token = await recoveryToken();
    expect((await call(gw, 'GET', '/admin/overview', {token})).status).toBe(
      200,
    );
    expect((await call(gw, 'GET', '/objects', {token})).status).toBe(200);
  });

  it('fewer than 2 passkeys: only /me, passkey registration, step-up and logout', async () => {
    const gw = await makeGateway({
      identity: {
        ...identity,
        adminSessionStatus: status({setupIncomplete: true}),
      },
      objects,
    });
    const token = await adminToken();
    for (const [m, p, body] of [
      ['GET', '/me'],
      ['GET', '/admin/passkeys'],
      ['POST', '/admin/passkeys/options', {}],
      ['POST', '/auth/passkeys/options', {purpose: 'step_up'}],
      ['DELETE', '/auth/sessions/current'],
    ] as [string, string, unknown?][]) {
      const res = await call(gw, m, p, {token, body});
      expect(res.status, `${m} ${p}`).toBeLessThan(300);
    }
    for (const [m, p, headers] of [
      ['GET', '/admin/overview'],
      ['GET', '/admin/users'],
      ['GET', '/objects'],
      ['GET', '/objects', {'x-act-as-tenant': TARGET_TID}],
    ] as [string, string, Record<string, string>?][]) {
      const res = await call(gw, m, p, {token, headers});
      expect(res.status, `${m} ${p}`).toBe(403);
      const body = (await res.json()) as {code: string; reason: string};
      expect(body).toMatchObject({
        code: 'FORBIDDEN',
        reason: 'PASSKEY_SETUP_INCOMPLETE',
      });
    }
  });

  it('passes the sid to identity in the ctx', async () => {
    const getMe = vi.fn(async (_ctx: CallCtx) => sampleMe('admin'));
    const gw = await makeGateway({identity: {...identity, getMe}, objects});
    await call(gw, 'GET', '/me', {token: await adminToken({sid: 'sid-z'})});
    expect(getMe.mock.calls[0][0].sid).toBe('sid-z');
  });
});

describe('scope and role', () => {
  const services = {
    identity: {
      adminOverview: async () => ({}) as never,
      adminListPasskeys: async () => [],
    },
  };

  it('owners get 403 on /admin/*', async () => {
    const gw = await makeGateway(services);
    const res = await call(gw, 'GET', '/admin/overview', {
      token: await ownerToken(),
    });
    expect(res.status).toBe(403);
    expect((await problemOf(res)).code).toBe('FORBIDDEN');
  });

  it('admin scope requires amr ⊇ passkey', async () => {
    const gw = await makeGateway(services);
    const otpOnly = await adminToken({amr: ['otp']});
    expect(
      (await call(gw, 'GET', '/admin/overview', {token: otpOnly})).status,
    ).toBe(403);
    const rec = await makeGateway({
      identity: {
        ...services.identity,
        adminSessionStatus: status({recoveryPending: true}),
      },
    });
    const recovery = await adminToken({amr: ['otp', 'recovery']});
    expect(
      (await call(rec, 'GET', '/admin/overview', {token: recovery})).status,
    ).toBe(403);
    // A recovery session may manage passkeys (it must bind a new one).
    expect(
      (await call(rec, 'GET', '/admin/passkeys', {token: recovery})).status,
    ).toBe(200);
    expect(
      (await call(gw, 'GET', '/admin/overview', {token: await adminToken()}))
        .status,
    ).toBe(200);
  });
});

describe('Act-as-Tenant', () => {
  function objects() {
    const seen: CallCtx[] = [];
    return {
      seen,
      objects: {
        getObject: async (ctx: CallCtx) => {
          seen.push(ctx);
          return objectDto() as never;
        },
        patchObject: async (ctx: CallCtx) => {
          seen.push(ctx);
          return objectDto(4) as never;
        },
      },
    };
  }

  it('owner sending X-Act-As-Tenant → 403, even on own-account routes', async () => {
    const o = objects();
    const gw = await makeGateway({
      objects: o.objects,
      identity: {patchMe: async () => sampleMe()},
    });
    const token = await ownerToken();
    const headers = {'x-act-as-tenant': TARGET_TID};
    const a = await call(gw, 'GET', `/objects/${RID}`, {token, headers});
    expect(a.status).toBe(403);
    expect((await problemOf(a)).code).toBe('FORBIDDEN');
    const b = await call(gw, 'PATCH', '/me', {
      token,
      headers,
      body: {locale: 'en-US'},
    });
    expect(b.status).toBe(403);
    expect(o.seen).toHaveLength(0);
  });

  it('admin reads the target workspace with actor admin/actingAs', async () => {
    const o = objects();
    const gw = await makeGateway({objects: o.objects});
    const res = await call(gw, 'GET', `/objects/${RID}`, {
      token: await adminToken(),
      headers: {'x-act-as-tenant': TARGET_TID},
    });
    expect(res.status).toBe(200);
    expect(o.seen[0]).toMatchObject({
      tid: TARGET_TID,
      sub: ADMIN_UID,
      actor: {role: 'admin', userId: ADMIN_UID, actingAs: true},
    });
    expect(gw.audits.map(a => a.action)).toEqual(['act_as.enter']);
    expect(gw.audits[0].ctx.tid).toBe(TARGET_TID);
  });

  it('without the header the admin works in its own workspace', async () => {
    const o = objects();
    const gw = await makeGateway({objects: o.objects});
    await call(gw, 'GET', `/objects/${RID}`, {token: await adminToken()});
    expect(o.seen[0]).toMatchObject({
      tid: ADMIN_TID,
      actor: {role: 'admin', actingAs: false},
    });
    expect(gw.audits).toHaveLength(0);
  });

  it('unknown targets, admin workspaces and malformed ids → 404', async () => {
    const o = objects();
    const gw = await makeGateway({
      objects: o.objects,
      identity: {
        workspaceStatus: async tid =>
          tid === ADMIN_TID ? {kind: 'admin', status: 'ACTIVE'} : null,
      },
    });
    const token = await adminToken();
    for (const target of [TEST_TID, ADMIN_TID, 'not-a-ulid']) {
      const res = await call(gw, 'GET', `/objects/${RID}`, {
        token,
        headers: {'x-act-as-tenant': target},
      });
      expect(res.status).toBe(404);
      expect((await problemOf(res)).code).toBe('NOT_FOUND');
    }
    expect(o.seen).toHaveLength(0);
  });

  it('writes need an ACTIVE target (409), reads do not', async () => {
    const o = objects();
    const gw = await makeGateway({
      objects: o.objects,
      identity: {
        workspaceStatus: async () => ({kind: 'trial', status: 'EXPIRED'}),
      },
    });
    const token = await adminToken();
    const headers = {'x-act-as-tenant': TARGET_TID};
    const read = await call(gw, 'GET', `/objects/${RID}`, {token, headers});
    expect(read.status).toBe(200);
    const write = await call(gw, 'PATCH', `/objects/${RID}`, {
      token,
      headers: {...headers, 'if-match': '"v3"'},
      body: {x: 1},
    });
    expect(write.status).toBe(409);
    expect((await problemOf(write)).code).toBe('CONFLICT');
    expect(o.seen).toHaveLength(1);
  });

  it('caches the target status for ACT_AS_CACHE_S', async () => {
    let status: 'ACTIVE' | 'EXPIRED' = 'ACTIVE';
    const workspaceStatus = vi.fn(async () => ({
      kind: 'trial' as const,
      status,
    }));
    const o = objects();
    const gw = await makeGateway({
      objects: o.objects,
      identity: {workspaceStatus},
    });
    const token = await adminToken();
    const patch = () =>
      call(gw, 'PATCH', `/objects/${RID}`, {
        token,
        headers: {'x-act-as-tenant': TARGET_TID, 'if-match': '"v3"'},
        body: {x: 1},
      });
    expect((await patch()).status).toBe(200);
    status = 'EXPIRED';
    expect((await patch()).status).toBe(200); // still cached
    gw.clock.advance(61_000);
    expect((await patch()).status).toBe(409);
    expect(workspaceStatus).toHaveBeenCalledTimes(2);
    // act_as.enter once per cache window; tenant.write for each write.
    expect(gw.audits.map(a => a.action)).toEqual([
      'act_as.enter',
      'tenant.write',
      'tenant.write',
    ]);
  });

  it('records tenant.write with the operationId before the RPC', async () => {
    const o = objects();
    const gw = await makeGateway({objects: o.objects});
    const res = await call(gw, 'PATCH', `/objects/${RID}`, {
      token: await adminToken(),
      headers: {'x-act-as-tenant': TARGET_TID, 'if-match': '"v3"'},
      body: {x: 1},
    });
    expect(res.status).toBe(200);
    const write = gw.audits.find(a => a.action === 'tenant.write');
    expect(write?.reason).toBe('patchObject');
    expect(write?.ctx.actor.actingAs).toBe(true);
    const auditIdx = gw.calls.lastIndexOf('IDENTITY.audit');
    const rpcIdx = gw.calls.indexOf('OBJECTS.patchObject');
    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(auditIdx).toBeLessThan(rpcIdx);
  });

  it('audit failure → 503 UNAVAILABLE and the RPC is not called', async () => {
    const o = objects();
    const gw = await makeGateway({
      objects: o.objects,
      identity: {
        audit: async (_ctx, entry) => {
          if (entry.action === 'tenant.write') throw new Error('d1 down');
        },
      },
    });
    const res = await call(gw, 'PATCH', `/objects/${RID}`, {
      token: await adminToken(),
      headers: {'x-act-as-tenant': TARGET_TID, 'if-match': '"v3"'},
      body: {x: 1},
    });
    expect(res.status).toBe(503);
    expect((await problemOf(res)).code).toBe('UNAVAILABLE');
    expect(gw.calls).not.toContain('OBJECTS.patchObject');
  });

  it('act_as.enter failure → 503', async () => {
    const o = objects();
    const gw = await makeGateway({
      objects: o.objects,
      identity: {audit: async () => Promise.reject(new Error('down'))},
    });
    const res = await call(gw, 'GET', `/objects/${RID}`, {
      token: await adminToken(),
      headers: {'x-act-as-tenant': TARGET_TID},
    });
    expect(res.status).toBe(503);
    expect(o.seen).toHaveLength(0);
  });

  it('admin routes ignore the header (no Act-as)', async () => {
    const adminOverview = vi.fn(async (ctx: CallCtx) => {
      expect(ctx.tid).toBe(ADMIN_TID);
      return {} as never;
    });
    const gw = await makeGateway({identity: {adminOverview}});
    const res = await call(gw, 'GET', '/admin/overview', {
      token: await adminToken(),
      headers: {'x-act-as-tenant': TARGET_TID},
    });
    expect(res.status).toBe(200);
    expect(adminOverview).toHaveBeenCalledOnce();
  });

  it('writes without Act-as are not audited by the gateway', async () => {
    const o = objects();
    const gw = await makeGateway({objects: o.objects});
    await call(gw, 'PATCH', `/objects/${RID}`, {
      token: await ownerToken(),
      headers: {'if-match': '"v3"'},
      body: {x: 1},
    });
    expect(gw.audits).toHaveLength(0);
  });
});

describe('rate limits', () => {
  it('429 RATE_LIMITED with Retry-After on the user read class', async () => {
    const gw = await makeGateway(
      {identity: {getMe: async () => sampleMe()}},
      {limits: {read: 2}},
    );
    const token = await ownerToken();
    expect((await call(gw, 'GET', '/me', {token})).status).toBe(200);
    expect((await call(gw, 'GET', '/me', {token})).status).toBe(200);
    const res = await call(gw, 'GET', '/me', {token});
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect((await problemOf(res)).code).toBe('RATE_LIMITED');
  });

  it('keys read/write by sub', async () => {
    const gw = await makeGateway(
      {identity: {getMe: async () => sampleMe()}},
      {limits: {read: 1}},
    );
    expect(
      (await call(gw, 'GET', '/me', {token: await ownerToken()})).status,
    ).toBe(200);
    const other = await ownerToken({sub: '01K6A000000000000000000U02'});
    expect((await call(gw, 'GET', '/me', {token: other})).status).toBe(200);
  });

  it('limits /auth/codes by normalized e-mail and by IP', async () => {
    const gw = await makeGateway(
      {identity: {sendCode: async () => undefined}},
      {limits: {email: 1, ip: 2}},
    );
    const body = (email: string) => ({
      email,
      purpose: 'login',
      turnstileToken: 't',
    });
    const ip1 = {'cf-connecting-ip': '198.51.100.1'};
    expect(
      (
        await call(gw, 'POST', '/auth/codes', {
          body: body('A@x.io'),
          headers: ip1,
        })
      ).status,
    ).toBe(202);
    const again = await call(gw, 'POST', '/auth/codes', {
      body: body(' a@X.io '),
      headers: {'cf-connecting-ip': '198.51.100.2'},
    });
    expect(again.status).toBe(429);
    expect(
      (
        await call(gw, 'POST', '/auth/codes', {
          body: body('b@x.io'),
          headers: ip1,
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await call(gw, 'POST', '/auth/codes', {
          body: body('c@x.io'),
          headers: ip1,
        })
      ).status,
    ).toBe(429);
  });
});

describe('validation and required headers', () => {
  it('400 VALIDATION_FAILED with field errors', async () => {
    const gw = await makeGateway({identity: {sendCode: async () => undefined}});
    const res = await call(gw, 'POST', '/auth/codes', {
      body: {email: 'nope', purpose: 'terminate'},
    });
    expect(res.status).toBe(400);
    const p = await problemOf(res);
    expect(p.code).toBe('VALIDATION_FAILED');
    const paths = (p.errors ?? []).map(e => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['email', 'purpose', 'turnstileToken']),
    );
  });

  it('rejects malformed JSON (400) and foreign content types (415)', async () => {
    const gw = await makeGateway();
    const a = await call(gw, 'POST', '/auth/codes', {rawBody: '{oops'});
    expect(a.status).toBe(400);
    const b = await call(gw, 'POST', '/auth/codes', {
      rawBody: 'email=a',
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(b.status).toBe(415);
    expect((await problemOf(b)).code).toBe('VALIDATION_FAILED');
  });

  it('validates path parameters and queries', async () => {
    const gw = await makeGateway({
      objects: {getObject: async () => objectDto() as never},
    });
    const token = await ownerToken();
    expect((await call(gw, 'GET', '/objects/not-a-rid', {token})).status).toBe(
      400,
    );
    expect((await call(gw, 'GET', '/imports?limit=101', {token})).status).toBe(
      400,
    );
  });

  it('If-Match: missing → 400, parsed value reaches the RPC', async () => {
    const patchObject = vi.fn(async () => objectDto(8) as never);
    const gw = await makeGateway({objects: {patchObject}});
    const token = await ownerToken();
    const missing = await call(gw, 'PATCH', `/objects/${RID}`, {
      token,
      body: {a: 1},
    });
    expect(missing.status).toBe(400);
    const bad = await call(gw, 'PATCH', `/objects/${RID}`, {
      token,
      body: {a: 1},
      headers: {'if-match': 'abc'},
    });
    expect(bad.status).toBe(400);
    const ok = await call(gw, 'PATCH', `/objects/${RID}`, {
      token,
      body: {a: 1},
      headers: {'if-match': 'W/"v7"'},
      contentType: 'application/merge-patch+json',
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('etag')).toBe('"v8"');
    expect(patchObject).toHaveBeenCalledWith(expect.anything(), RID, {a: 1}, 7);
  });

  it('Idempotency-Key is required and shape-checked', async () => {
    const decide = vi.fn(async () => ({id: 'r1'}) as never);
    const gw = await makeGateway({decision: {decide}});
    const token = await ownerToken();
    const body = {decision: 'confirm'};
    expect(
      (await call(gw, 'POST', '/recommendations/r1/decision', {token, body}))
        .status,
    ).toBe(400);
    expect(
      (
        await call(gw, 'POST', '/recommendations/r1/decision', {
          token,
          body,
          headers: {'idempotency-key': 'short'},
        })
      ).status,
    ).toBe(400);
    const ok = await call(gw, 'POST', '/recommendations/r1/decision', {
      token,
      body,
      headers: {'idempotency-key': 'key-0123456789abcdef'},
    });
    expect(ok.status).toBe(200);
    expect(decide).toHaveBeenCalledWith(
      expect.anything(),
      'r1',
      {decision: 'confirm'},
      'key-0123456789abcdef',
    );
  });

  it('X-Step-Up missing → 403 FORBIDDEN on high-risk admin writes', async () => {
    const adminPatchUser = vi.fn(async () => ({}) as never);
    const gw = await makeGateway({identity: {adminPatchUser}});
    const token = await adminToken();
    const path = `/admin/users/${TEST_UID}`;
    const body = {banned: true, reason: 'abuse'};
    const headers = {'idempotency-key': 'key-0123456789abcdef'};
    const res = await call(gw, 'PATCH', path, {token, body, headers});
    expect(res.status).toBe(403);
    expect((await problemOf(res)).code).toBe('FORBIDDEN');
    const ok = await call(gw, 'PATCH', path, {
      token,
      body,
      headers: {...headers, 'x-step-up': 'su-token'},
    });
    expect(ok.status).toBe(200);
    expect(adminPatchUser).toHaveBeenCalledWith(
      expect.anything(),
      TEST_UID,
      body,
      'su-token',
      'key-0123456789abcdef',
    );
  });

  it('a recovery session binds a passkey without X-Step-Up', async () => {
    const adminAddPasskey = vi.fn(
      async () => ({passkey: {}, total: 1}) as never,
    );
    const rec = await makeGateway({
      identity: {
        adminAddPasskey,
        adminSessionStatus: status({recoveryPending: true}),
      },
    });
    const res = await call(rec, 'POST', '/admin/passkeys', {
      token: await adminToken({amr: ['otp', 'recovery']}),
      body: {credential: {id: 'c'}},
    });
    expect(res.status).toBe(201);
    // Once the session is upgraded (not pending) a step-up is required.
    const gw = await makeGateway({identity: {adminAddPasskey}});
    const upgraded = await call(gw, 'POST', '/admin/passkeys', {
      token: await adminToken({amr: ['otp', 'recovery']}),
      body: {credential: {id: 'c'}},
    });
    expect(upgraded.status).toBe(403);
    const denied = await call(gw, 'POST', '/admin/passkeys', {
      token: await adminToken(),
      body: {credential: {id: 'c'}},
    });
    expect(denied.status).toBe(403);
  });
});

describe('CallCtx and Problem Details', () => {
  it('passes {tid, sub, actor, requestId, locale} to the RPC', async () => {
    let seen: CallCtx | undefined;
    const gw = await makeGateway({
      objects: {
        stats: async ctx => {
          seen = ctx;
          return {objects: 1, links: 0, byType: {}};
        },
      },
    });
    await call(gw, 'GET', '/objects/stats', {
      token: await ownerToken(),
      headers: {
        'x-request-id': 'trace-12345678',
        'accept-language': 'fr-FR, en-GB;q=0.8, zh;q=0.5',
      },
    });
    expect(seen).toEqual({
      tid: TEST_TID,
      sub: TEST_UID,
      actor: {role: 'owner', userId: TEST_UID, actingAs: false},
      requestId: 'trace-12345678',
      locale: 'en-US',
      sid: 'sid-1',
    });
  });

  it('maps RPC AppErrors with their code, status and extras', async () => {
    const gw = await makeGateway({
      objects: {
        patchObject: async () => {
          throw new AppError('PRECONDITION_FAILED', 'stale', {
            extras: {current: 9},
          });
        },
      },
    });
    const res = await call(gw, 'PATCH', `/objects/${RID}`, {
      token: await ownerToken(),
      headers: {'if-match': '"v3"', 'x-request-id': 'trace-abcdefgh'},
      body: {a: 1},
    });
    expect(res.status).toBe(412);
    const p = (await problemOf(res)) as Record<string, unknown>;
    expect(p).toMatchObject({
      code: 'PRECONDITION_FAILED',
      status: 412,
      title: 'PRECONDITION_FAILED',
      detail: 'stale',
      traceId: 'trace-abcdefgh',
      current: 9,
    });
    expect(typeof p.type).toBe('string');
  });

  it('hides unexpected errors behind INTERNAL', async () => {
    const gw = await makeGateway({
      objects: {
        stats: async () => {
          throw new Error('SQLITE_BUSY secret detail');
        },
      },
    });
    const res = await call(gw, 'GET', '/objects/stats', {
      token: await ownerToken(),
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('INTERNAL');
    expect(text).not.toContain('secret');
  });

  it('every Problem code is a known error code', () => {
    expect(ERROR_CODES).toContain('VALIDATION_FAILED');
    expect(ERROR_CODES).toContain('TRIAL_EXPIRED');
  });
});
