/**
 * @fileoverview Test harness for the gateway: fake service bindings
 * (rpcBinding / fetcherBinding, so errors cross a simulated RPC boundary),
 * FakeRateLimiter bindings, real Ed25519 keys and token minting. Other
 * `*_test.ts` files import it; it also checks itself.
 */

import type {DecisionRpc} from '@ontodecide/decision/contract';
import type {IdentityRpc, MeDto} from '@ontodecide/identity/contract';
import type {IntegrationRpc} from '@ontodecide/integration/contract';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {SituationRpc} from '@ontodecide/situation/contract';
import {
  FixedClock,
  generateSigningKey,
  publicJwkOf,
  signJwt,
  silentLogger,
  type AccessClaims,
  type AuthMethod,
  type CallCtx,
  type Ed25519Jwk,
  type WorkspaceStatus,
} from '@ontodecide/shared-kernel';
import {
  FakeRateLimiter,
  TEST_TID,
  TEST_UID,
  fetcherBinding,
  rpcBinding,
} from '@ontodecide/testing';
import {describe, expect, it, vi} from 'vitest';
import {createApp, type GatewayApp} from './app';
import type {Env} from './env';

/** App origin used by tests. */
export const ORIGIN = 'https://app.example.com';

/** Base URL of the API. */
export const BASE = `${ORIGIN}/api/v1`;

/** Fixed test instant. */
export const T0 = '2026-09-24T08:00:00Z';

/** Admin user / workspace ids. */
export const ADMIN_UID = '01K6A000000000000000000A01';
export const ADMIN_TID = '01K6A000000000000000000A02';

/** A second trial workspace (Act-as target). */
export const TARGET_TID = '01K6A000000000000000000T02';

let keyPromise: Promise<Ed25519Jwk> | undefined;
let otherKeyPromise: Promise<Ed25519Jwk> | undefined;

/** The signing key whose public half the gateway trusts. */
export function signingKey(): Promise<Ed25519Jwk> {
  return (keyPromise ??= generateSigningKey('k1'));
}

/** A key the gateway does not trust (same kid). */
export function untrustedKey(): Promise<Ed25519Jwk> {
  return (otherKeyPromise ??= generateSigningKey('k1'));
}

type Fake<T> = {[K in keyof T]?: T[K]};

/** Fake service implementations. */
export interface FakeServices {
  identity?: Fake<IdentityRpc>;
  ontology?: Fake<OntologyRpc>;
  integration?: Fake<IntegrationRpc>;
  objects?: Fake<ObjectGraphRpc>;
  situation?: Fake<SituationRpc>;
  situationFetch?: (req: Request) => Promise<Response>;
  decision?: Fake<DecisionRpc>;
}

/** A sample MeDto. */
export function sampleMe(role: 'owner' | 'admin' = 'owner'): MeDto {
  return {
    userId: role === 'owner' ? TEST_UID : ADMIN_UID,
    email: 'a@example.com',
    role,
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    workspace: {
      tenantId: role === 'owner' ? TEST_TID : ADMIN_TID,
      kind: role === 'owner' ? 'trial' : 'admin',
      status: 'ACTIVE',
      verifiedAt: T0,
      trialExpiresAt: role === 'owner' ? '2026-09-27T08:00:00Z' : null,
      expiredAt: null,
    },
    sessions: {used: 1, limit: 3},
  };
}

/** Everything a gateway test needs. */
export interface TestGateway {
  app: GatewayApp;
  env: Env;
  clock: FixedClock;
  /** Identity fake (with default admin-session and audit behavior). */
  identity: Fake<IdentityRpc>;
  /** Audit entries in call order, with the ctx they were recorded under. */
  audits: {ctx: CallCtx; action: string; reason?: string}[];
  /** Call log across services, in order (`SERVICE.method`). */
  calls: string[];
  limiters: Record<'read' | 'write' | 'email' | 'ip', FakeRateLimiter>;
}

function traced<T extends object>(name: string, impl: T, calls: string[]): T {
  return new Proxy(impl, {
    get(target, prop) {
      const v = (target as Record<string | symbol, unknown>)[prop];
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        calls.push(`${name}.${String(prop)}`);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/** Builds a gateway over fake services. */
export function makeGateway(
  services: FakeServices = {},
  opts: {
    limits?: Partial<Record<'read' | 'write' | 'email' | 'ip', number>>;
    env?: Partial<Env>;
  } = {},
): Promise<TestGateway> {
  return (async () => {
    const key = await signingKey();
    const clock = new FixedClock(T0);
    const calls: string[] = [];
    const audits: TestGateway['audits'] = [];
    const identity: Fake<IdentityRpc> = {
      verifyAdminSession: async () => true,
      adminSessionStatus: async () => ({
        valid: true,
        recoveryPending: false,
        setupIncomplete: false,
      }),
      workspaceStatus: async tid =>
        tid === TARGET_TID ? {kind: 'trial', status: 'ACTIVE'} : null,
      audit: async (ctx, entry) => {
        audits.push({ctx, action: entry.action, reason: entry.reason});
      },
      ...services.identity,
    };
    const l = opts.limits ?? {};
    const limiters = {
      read: new FakeRateLimiter(l.read ?? 1000),
      write: new FakeRateLimiter(l.write ?? 1000),
      email: new FakeRateLimiter(l.email ?? 1000),
      ip: new FakeRateLimiter(l.ip ?? 1000),
    };
    const situationFetch =
      services.situationFetch ??
      (async () => new Response('no stream', {status: 500}));
    const env: Env = {
      IDENTITY: rpcBinding(traced('IDENTITY', identity, calls)) as IdentityRpc,
      ONTOLOGY: rpcBinding(
        traced('ONTOLOGY', services.ontology ?? {}, calls),
      ) as OntologyRpc,
      INTEGRATION: rpcBinding(
        traced('INTEGRATION', services.integration ?? {}, calls),
      ) as IntegrationRpc,
      OBJECTS: rpcBinding(
        traced('OBJECTS', services.objects ?? {}, calls),
      ) as ObjectGraphRpc,
      SITUATION: fetcherBinding(
        situationFetch,
        traced('SITUATION', services.situation ?? {}, calls),
      ) as unknown as Env['SITUATION'],
      DECISION: rpcBinding(
        traced('DECISION', services.decision ?? {}, calls),
      ) as DecisionRpc,
      RL_USER_READ: limiters.read.asRateLimit(),
      RL_USER_WRITE: limiters.write.asRateLimit(),
      RL_EMAIL: limiters.email.asRateLimit(),
      RL_IP_AUTH: limiters.ip.asRateLimit(),
      APP_ORIGIN: ORIGIN,
      JWT_PUBLIC_KEYS: JSON.stringify({keys: [publicJwkOf(key)]}),
      MAX_BODY_BYTES: '524288',
      ACT_AS_CACHE_S: '60',
      ENVIRONMENT: 'test',
      APP_VERSION: '2.4.0-test',
      ...opts.env,
    };
    const app = createApp(env, {clock, logger: silentLogger});
    return {app, env, clock, identity, audits, calls, limiters};
  })();
}

/** Claims overrides for {@link mintToken}. */
export interface TokenOpts {
  role?: 'owner' | 'admin';
  sub?: string;
  tid?: string;
  st?: WorkspaceStatus;
  /** Trial end relative to T0, seconds (owner only; default +72 h). */
  texpIn?: number;
  sid?: string;
  amr?: AuthMethod[];
  /** Expiry relative to T0, seconds (default +900). */
  expIn?: number;
  key?: Ed25519Jwk;
}

/** Signs an access token at {@link T0}. */
export async function mintToken(o: TokenOpts = {}): Promise<string> {
  const role = o.role ?? 'owner';
  const now = Math.floor(Date.parse(T0) / 1000);
  const claims: AccessClaims = {
    sub: o.sub ?? (role === 'owner' ? TEST_UID : ADMIN_UID),
    role,
    tid: o.tid ?? (role === 'owner' ? TEST_TID : ADMIN_TID),
    st: o.st ?? 'ACTIVE',
    ...(role === 'owner' ? {texp: now + (o.texpIn ?? 72 * 3600)} : {}),
    sid: o.sid ?? 'sid-1',
    amr: o.amr ?? (role === 'owner' ? ['otp'] : ['otp', 'passkey']),
    iat: now,
    exp: now + (o.expIn ?? 900),
  };
  return signJwt(claims, o.key ?? (await signingKey()));
}

/** Owner token. */
export const ownerToken = (o: TokenOpts = {}) => mintToken(o);

/** Admin token (otp + passkey). */
export const adminToken = (o: TokenOpts = {}) =>
  mintToken({role: 'admin', ...o});

/** Request options for {@link call}. */
export interface CallOpts {
  token?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  /** Send Origin (default true). */
  origin?: boolean | string;
  contentType?: string;
}

/** Sends a request to the gateway. */
export function call(
  gw: TestGateway,
  method: string,
  path: string,
  o: CallOpts = {},
): Promise<Response> {
  const headers = new Headers(o.headers ?? {});
  if (o.token) headers.set('authorization', `Bearer ${o.token}`);
  if (o.origin !== false) {
    headers.set('origin', typeof o.origin === 'string' ? o.origin : ORIGIN);
  }
  headers.set(
    'cf-connecting-ip',
    headers.get('cf-connecting-ip') ?? '203.0.113.7',
  );
  let body: string | undefined = o.rawBody;
  if (o.body !== undefined) body = JSON.stringify(o.body);
  if (body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', o.contentType ?? 'application/json');
  }
  return gw.app.fetch(new Request(`${BASE}${path}`, {method, headers, body}));
}

/** Reads a Problem Details body and checks its media type. */
export async function problemOf(res: Response): Promise<{
  code: string;
  status: number;
  traceId?: string;
  errors?: {path: string}[];
}> {
  expect(res.headers.get('content-type')).toContain('application/problem+json');
  return (await res.json()) as {code: string; status: number; traceId?: string};
}

/** Spy helper returning a resolved value. */
export function resolves<T>(value: T) {
  return vi.fn(async () => value);
}

describe('harness', () => {
  it('builds a gateway that answers /health', async () => {
    const gw = await makeGateway();
    const res = await call(gw, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'ok',
      version: '2.4.0-test',
    });
  });

  it('mints tokens the gateway accepts', async () => {
    const gw = await makeGateway({identity: {getMe: async () => sampleMe()}});
    const res = await call(gw, 'GET', '/me', {token: await ownerToken()});
    expect(res.status).toBe(200);
  });

  it('untrusted key is a different key', async () => {
    expect((await untrustedKey()).x).not.toBe((await signingKey()).x);
  });
});
