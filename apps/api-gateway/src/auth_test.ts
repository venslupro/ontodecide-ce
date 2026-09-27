/**
 * @fileoverview Session endpoints: the `__Host-od_rt` cookie (attributes,
 * expiry from refreshExpiresAt, rotation, clearing), no refresh token in
 * bodies, admin passkey flows and RequestMeta forwarding.
 */

import type {IssuedSession, RequestMeta} from '@ontodecide/identity/contract';
import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import {describe, expect, it, vi} from 'vitest';
import {
  T0,
  adminToken,
  call,
  makeGateway,
  ownerToken,
  problemOf,
  sampleMe,
} from './harness_test';

const REFRESH_AT = Date.parse(T0) + 72 * 3600 * 1000;

function issued(role: 'owner' | 'admin' = 'owner'): IssuedSession {
  return {
    kind: 'session',
    accessToken: 'at-1',
    expiresIn: 900,
    refreshToken: 'rt-secret-1',
    refreshExpiresAt: REFRESH_AT,
    amr: role === 'owner' ? ['otp'] : ['otp', 'passkey'],
    me: sampleMe(role),
  };
}

function expectCookie(res: Response, token: string): void {
  const c = res.headers.get('set-cookie') ?? '';
  expect(c.startsWith(`__Host-od_rt=${token};`)).toBe(true);
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) {
    expect(c).toContain(attr);
  }
  expect(c).not.toMatch(/Domain=/i);
  expect(c).toContain(`Expires=${new Date(REFRESH_AT).toUTCString()}`);
  expect(c).toContain(`Max-Age=${72 * 3600}`);
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

describe('POST /auth/sessions', () => {
  it('owner: 201 with the cookie and without the refresh token in the body', async () => {
    let meta: RequestMeta | undefined;
    const gw = await makeGateway({
      identity: {
        createSession: async (_input, m) => {
          meta = m;
          return issued();
        },
      },
    });
    const res = await call(gw, 'POST', '/auth/sessions', {
      body: {email: 'A@Example.com', code: '123456', purpose: 'signup'},
      headers: {'user-agent': UA, 'cf-connecting-ip': '198.51.100.9'},
    });
    expect(res.status).toBe(201);
    expectCookie(res, 'rt-secret-1');
    const text = await res.text();
    expect(text).not.toContain('rt-secret-1');
    expect(text).not.toContain('refreshToken');
    expect(JSON.parse(text)).toEqual({
      accessToken: 'at-1',
      expiresIn: 900,
      me: sampleMe(),
    });
    expect(meta).toEqual({ip: '198.51.100.9', client: 'Chrome · macOS'});
  });

  it('admin: 200 passkeyRequired without a cookie', async () => {
    const gw = await makeGateway({
      identity: {
        createSession: async () => ({
          kind: 'passkeyRequired',
          preAuth: 'pre-1',
          setupRequired: true,
        }),
      },
    });
    const res = await call(gw, 'POST', '/auth/sessions', {
      body: {email: 'root@example.com', code: '123456', purpose: 'login'},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({
      passkeyRequired: true,
      preAuth: 'pre-1',
      setupRequired: true,
    });
  });

  it('forwards CODE_INVALID from identity-access', async () => {
    const gw = await makeGateway({
      identity: {
        createSession: async () => {
          throw new AppError('CODE_INVALID');
        },
      },
    });
    const res = await call(gw, 'POST', '/auth/sessions', {
      body: {email: 'a@example.com', code: '000000', purpose: 'login'},
    });
    expect(res.status).toBe(400);
    expect((await problemOf(res)).code).toBe('CODE_INVALID');
  });
});

describe('POST /auth/sessions/refresh', () => {
  it('rotates the cookie and returns only the access token', async () => {
    const refresh = vi.fn(async () => ({
      accessToken: 'at-2',
      expiresIn: 900,
      refreshToken: 'rt-secret-2',
      refreshExpiresAt: REFRESH_AT,
    }));
    const gw = await makeGateway({identity: {refresh}});
    const res = await call(gw, 'POST', '/auth/sessions/refresh', {
      headers: {cookie: 'other=1; __Host-od_rt=rt-secret-1'},
    });
    expect(res.status).toBe(200);
    expectCookie(res, 'rt-secret-2');
    expect(await res.json()).toEqual({accessToken: 'at-2', expiresIn: 900});
    expect(refresh).toHaveBeenCalledWith('rt-secret-1', {ip: '203.0.113.7'});
  });

  it('401 without the cookie', async () => {
    const gw = await makeGateway();
    const res = await call(gw, 'POST', '/auth/sessions/refresh');
    expect(res.status).toBe(401);
    expect((await problemOf(res)).code).toBe('UNAUTHENTICATED');
  });

  it('clears the cookie when identity rejects the token (family replay)', async () => {
    const gw = await makeGateway({
      identity: {
        refresh: async () => {
          throw new AppError('TRIAL_EXPIRED');
        },
      },
    });
    const res = await call(gw, 'POST', '/auth/sessions/refresh', {
      headers: {cookie: '__Host-od_rt=old'},
    });
    expect(res.status).toBe(401);
    expect((await problemOf(res)).code).toBe('TRIAL_EXPIRED');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('DELETE /auth/sessions/current', () => {
  it('logs out the token session and clears the cookie', async () => {
    const logout = vi.fn(async (_ctx: CallCtx, _sid: string) => undefined);
    const gw = await makeGateway({identity: {logout}});
    const res = await call(gw, 'DELETE', '/auth/sessions/current', {
      token: await ownerToken({sid: 'sid-9'}),
    });
    expect(res.status).toBe(204);
    const c = res.headers.get('set-cookie') ?? '';
    expect(c).toContain('__Host-od_rt=;');
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('HttpOnly; Secure; SameSite=Strict; Path=/');
    expect(logout.mock.calls[0][1]).toBe('sid-9');
  });

  it('clears the cookie even when the token is rejected', async () => {
    const gw = await makeGateway();
    const res = await call(gw, 'DELETE', '/auth/sessions/current');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('admin passkeys', () => {
  it('login options need preAuth and no token', async () => {
    const passkeyOptions = vi.fn(async () => ({challenge: 'c'}));
    const gw = await makeGateway({identity: {passkeyOptions}});
    const missing = await call(gw, 'POST', '/auth/passkeys/options', {
      body: {purpose: 'login'},
    });
    expect(missing.status).toBe(400);
    const ok = await call(gw, 'POST', '/auth/passkeys/options', {
      body: {purpose: 'login', preAuth: 'pre-1'},
    });
    expect(ok.status).toBe(200);
    expect(passkeyOptions).toHaveBeenCalledWith({preAuth: 'pre-1'}, 'login');
  });

  it('step_up needs an admin token and passes its ctx', async () => {
    const passkeyOptions = vi.fn(async () => ({challenge: 'c'}));
    const gw = await makeGateway({identity: {passkeyOptions}});
    const body = {purpose: 'step_up'};
    expect(
      (await call(gw, 'POST', '/auth/passkeys/options', {body})).status,
    ).toBe(401);
    const owner = await call(gw, 'POST', '/auth/passkeys/options', {
      body,
      token: await ownerToken(),
    });
    expect(owner.status).toBe(403);
    const ok = await call(gw, 'POST', '/auth/passkeys/options', {
      body,
      token: await adminToken(),
    });
    expect(ok.status).toBe(200);
    const auth = passkeyOptions.mock.calls[0] as unknown as [{ctx: CallCtx}];
    expect(auth[0].ctx.actor.role).toBe('admin');
  });

  it('assertion: login → 201 session + cookie; step_up → 200 token', async () => {
    const gw = await makeGateway({
      identity: {
        passkeyAssertion: async (_auth, purpose) =>
          purpose === 'login'
            ? issued('admin')
            : {stepUpToken: 'su-1', expiresIn: 300},
      },
    });
    const login = await call(gw, 'POST', '/auth/passkeys/assertion', {
      body: {purpose: 'login', preAuth: 'pre', credential: {id: 'x'}},
    });
    expect(login.status).toBe(201);
    expectCookie(login, 'rt-secret-1');
    expect(await login.text()).not.toContain('rt-secret-1');
    const step = await call(gw, 'POST', '/auth/passkeys/assertion', {
      body: {purpose: 'step_up', credential: {id: 'x'}},
      token: await adminToken(),
    });
    expect(step.status).toBe(200);
    expect(step.headers.get('set-cookie')).toBeNull();
    expect(await step.json()).toEqual({stepUpToken: 'su-1', expiresIn: 300});
  });

  it('first-passkey setup returns the passkey and the session + cookie', async () => {
    const gw = await makeGateway({
      identity: {
        passkeySetup: async () => ({
          passkey: {id: 'pk1', label: null, createdAt: T0, lastUsedAt: null},
          total: 1,
          session: issued('admin'),
        }),
      },
    });
    const res = await call(gw, 'POST', '/auth/passkeys/setup', {
      body: {preAuth: 'pre', setupCode: 'setup-code-1', credential: {id: 'x'}},
    });
    expect(res.status).toBe(201);
    expectCookie(res, 'rt-secret-1');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({total: 1, accessToken: 'at-1', expiresIn: 900});
    expect(body).not.toHaveProperty('session');
    expect(body).not.toHaveProperty('refreshToken');
  });

  it('recovery login → 201 session + cookie', async () => {
    const recoveryLogin = vi.fn(async () => issued('admin'));
    const gw = await makeGateway({identity: {recoveryLogin}});
    const res = await call(gw, 'POST', '/auth/recovery', {
      body: {preAuth: 'pre', recoveryCode: 'ABCD-EFGH'},
    });
    expect(res.status).toBe(201);
    expectCookie(res, 'rt-secret-1');
    expect(recoveryLogin).toHaveBeenCalledWith('pre', 'ABCD-EFGH', {
      ip: '203.0.113.7',
    });
  });
});
