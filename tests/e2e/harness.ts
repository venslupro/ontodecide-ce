/**
 * @fileoverview In-process full system: the seven Workers built with their
 * real `createService` / `createApp` composition roots over node:sqlite D1,
 * in-memory Durable Object storage and an in-memory queue bus, wired through
 * RPC-emulating bindings exactly as in docs/ARCHITECTURE.md 2.2. Only the
 * outside world is faked: Workers AI (absent → rule ranking), e-mail
 * providers, Turnstile, WebAuthn, and B2.
 */

import {
  FakeEmailSender,
  FakeTurnstile,
} from '../../packages/identity/interface/test_fixtures';
import {
  FakeLinkSigner,
  FakeWebAuthn,
  InMemoryBlobStore,
} from '../../packages/identity/infrastructure';
import type {SituationRoomCore} from '../../packages/situation/application';
import {
  InMemoryRoomStorage,
  MemorySocketHub,
} from '../../packages/situation/infrastructure';
import {
  FixedClock,
  generateSigningKey,
  publicJwkOf,
  silentLogger,
  type TenantLifecycleRpc,
} from '../../packages/shared-kernel';
import {
  FakeDoNamespace,
  FakeRateLimiter,
  MemorySqlStorage,
  QueueBus,
  createTestD1,
  fetcherBinding,
  rpcBinding,
} from '../../packages/testing';
import {createApp} from '../../apps/api-gateway/src/app';
import type {Env as GatewayEnv} from '../../apps/api-gateway/src/env';
import {createService as createDecision} from '../../apps/decision-engine/src/service';
import type {Env as DecisionEnv} from '../../apps/decision-engine/src/env';
import {createService as createIdentity} from '../../apps/identity-access/src/service';
import type {Env as IdentityEnv} from '../../apps/identity-access/src/env';
import {createService as createIntegration} from '../../apps/data-integration/src/service';
import type {Env as IntegrationEnv} from '../../apps/data-integration/src/env';
import {createService as createObjects} from '../../apps/object-graph/src/service';
import type {Env as ObjectsEnv} from '../../apps/object-graph/src/env';
import {createService as createOntology} from '../../apps/ontology-manager/src/service';
import type {Env as OntologyEnv} from '../../apps/ontology-manager/src/env';
import {
  createRoomCore,
  createService as createSituation,
} from '../../apps/situation-awareness/src/service';
import type {Env as SituationEnv} from '../../apps/situation-awareness/src/env';

/** Web origin of the test deployment. */
export const ORIGIN = 'https://app.ontodecide.test';

/** Bootstrap admin of the test deployment. */
export const ADMIN_EMAIL = 'root@ontodecide.test';
export const SETUP_CODE = 'setup-code-0123456789';

/** Deployed queue name (prefix as in production). */
const DOMAIN_EVENTS = 'ontodecide-test-domain-events';
const DEAD_LETTER = 'ontodecide-test-dead-letter';

/** A response with its parsed JSON body. */
export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
}

/** Request options of {@link System.api}. */
export interface ApiOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  cookie?: string;
  ip?: string;
}

/** The running system. */
export type System = Awaited<ReturnType<typeof createSystem>>;

/** Builds every service and the gateway. */
export async function createSystem() {
  const clock = new FixedClock('2026-09-24T08:00:00Z');
  const opts = {clock, logger: silentLogger};
  const bus = new QueueBus();
  const signingKey = await generateSigningKey('e2e-1');

  const ontologyEnv: OntologyEnv = {
    ONTOLOGY_DB: createTestD1('ontology-manager'),
    ENVIRONMENT: 'test',
  } as OntologyEnv;
  const ontology = createOntology(ontologyEnv, opts);

  const objectsEnv = {
    OBJECT_DB: createTestD1('object-graph'),
    ONTOLOGY: rpcBinding(ontology.rpc),
    DOMAIN_EVENTS: bus.sender(DOMAIN_EVENTS),
    MAX_OBJECTS: '300',
    MAX_LINKS: '900',
    ENVIRONMENT: 'test',
  } as unknown as ObjectsEnv;
  const objects = createObjects(objectsEnv, opts);

  const situationEnv = {
    OBJECTS: rpcBinding(objects.rpc),
    ONTOLOGY: rpcBinding(ontology.rpc),
    APP_ORIGIN: ORIGIN,
    ENVIRONMENT: 'test',
  } as unknown as SituationEnv;
  const hubs = new Map<string, MemorySocketHub>();
  const rooms = new FakeDoNamespace<SituationRoomCore>(name => {
    const sql = new MemorySqlStorage();
    const hub = new MemorySocketHub();
    hubs.set(name, hub);
    return createRoomCore(
      situationEnv,
      {sql, storage: new InMemoryRoomStorage(sql), sockets: hub},
      opts,
    );
  });
  Object.assign(situationEnv, {SITUATION_ROOM: rooms.asNamespace()});
  const situation = createSituation(situationEnv, opts);

  const decisionEnv = {
    DECISION_DB: createTestD1('decision-engine'),
    OBJECTS: rpcBinding(objects.rpc),
    SITUATION: rpcBinding(situation.rpc),
    ONTOLOGY: rpcBinding(ontology.rpc),
    ENVIRONMENT: 'test',
  } as unknown as DecisionEnv;
  const decision = createDecision(decisionEnv, {...opts, ai: null});

  const integrationEnv = {
    INTEGRATION_DB: createTestD1('data-integration'),
    ONTOLOGY: rpcBinding(ontology.rpc),
    OBJECTS: rpcBinding(objects.rpc),
    ENVIRONMENT: 'test',
  } as unknown as IntegrationEnv;
  const integration = createIntegration(integrationEnv, {...opts, ai: null});

  const lc = (m: {lifecycle?: TenantLifecycleRpc}) => {
    if (!m.lifecycle) throw new Error('service without TenantLifecycle');
    return rpcBinding(m.lifecycle);
  };
  const identityDb = createTestD1('identity-access');
  const identityEnv = {
    IDENTITY_DB: identityDb,
    LC_ONTOLOGY: lc(ontology),
    LC_INTEGRATION: lc(integration),
    LC_OBJECTS: lc(objects),
    LC_SITUATION: lc(situation),
    LC_DECISION: lc(decision),
    APP_ORIGIN: ORIGIN,
    MAIL_FROM: 'OntoDecide <noreply@mail.ontodecide.test>',
    EMAIL_MODE: 'live',
    B2_ARCHIVE_BUCKET: 'ontodecide-test-archive',
    B2_ENDPOINT: 's3.us-west-004.backblazeb2.com',
    B2_REGION: 'us-west-004',
    WEBAUTHN_RP_ID: 'app.ontodecide.test',
    ENVIRONMENT: 'test',
    JWT_SIGNING_KEY: JSON.stringify(signingKey),
    EMAIL_PEPPER: 'e2e-pepper',
    EMAIL_ENC_KEY: 'e2e-enc-key',
    TURNSTILE_SECRET: 'unused',
    B2_WRITE_KEY_ID: 'w',
    B2_WRITE_APP_KEY: 'w',
    B2_SIGN_KEY_ID: 's',
    B2_SIGN_APP_KEY: 's',
    BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_SETUP_CODE: SETUP_CODE,
  } as unknown as IdentityEnv;
  const blobs = new InMemoryBlobStore();
  const resend = new FakeEmailSender('resend');
  const brevo = new FakeEmailSender('brevo');
  const identity = createIdentity(identityEnv, {
    ...opts,
    blobs,
    signer: new FakeLinkSigner(),
    webauthn: new FakeWebAuthn(),
    turnstile: new FakeTurnstile(),
    mail: {mode: 'live', resend, brevo},
    analytics: null,
  });

  const limiter = () => new FakeRateLimiter(10_000).asRateLimit();
  const gatewayEnv: GatewayEnv = {
    IDENTITY: rpcBinding(identity.rpc),
    ONTOLOGY: rpcBinding(ontology.rpc),
    INTEGRATION: rpcBinding(integration.rpc),
    OBJECTS: rpcBinding(objects.rpc),
    SITUATION: fetcherBinding(req => situation.fetch!(req), situation.rpc),
    DECISION: rpcBinding(decision.rpc),
    RL_USER_READ: limiter(),
    RL_USER_WRITE: limiter(),
    RL_EMAIL: limiter(),
    RL_IP_AUTH: limiter(),
    APP_ORIGIN: ORIGIN,
    JWT_PUBLIC_KEYS: JSON.stringify({keys: [publicJwkOf(signingKey)]}),
    ENVIRONMENT: 'test',
  };
  const gateway = createApp(gatewayEnv, opts);

  /** Sends a request through the gateway (same-origin browser defaults). */
  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    o: ApiOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      origin: ORIGIN,
      'cf-connecting-ip': o.ip ?? '198.51.100.7',
      'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/140.0 Safari/537.36',
      ...o.headers,
    };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.cookie) headers.cookie = o.cookie;
    let body: string | undefined;
    if (o.body !== undefined) {
      headers['content-type'] ??= 'application/json';
      body = JSON.stringify(o.body);
    }
    const res = await gateway.fetch(
      new Request(`${ORIGIN}/api/v1${path}`, {method, headers, body}),
    );
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON body (e.g. JSON Lines export).
    }
    return {status: res.status, headers: res.headers, body: parsed as T};
  }

  /** Delivers queued domain events to situation-awareness. */
  async function drain(): Promise<void> {
    await bus.drain({
      [DOMAIN_EVENTS]: {
        handler: b => situation.queue!(b),
        maxBatchSize: 10,
        maxRetries: 3,
        deadLetterQueue: DEAD_LETTER,
      },
    });
  }

  /** Runs one tick of both crons at the current clock. */
  async function cronTick(): Promise<void> {
    await identity.scheduled!('*/2 * * * *', clock.now());
    await objects.scheduled!('*/15 * * * *', clock.now());
  }

  /** Captured e-mails of both providers, oldest first. */
  function mails() {
    return [...resend.sent, ...brevo.sent];
  }

  /** The last 6-digit code mailed to an address. */
  function lastCode(to: string): string {
    const m = mails()
      .filter(x => x.to === to && x.template.startsWith('code_'))
      .pop();
    const code = m && /\b(\d{6})\b/.exec(`${m.subject} ${m.text}`)?.[1];
    if (!code) throw new Error(`no code mailed to ${to}`);
    return code;
  }

  return {
    clock,
    bus,
    blobs,
    hubs,
    rooms,
    dbs: {
      identity: identityDb,
      ontology: ontologyEnv.ONTOLOGY_DB,
      objects: objectsEnv.OBJECT_DB,
      integration: integrationEnv.INTEGRATION_DB,
      decision: decisionEnv.DECISION_DB,
    },
    services: {ontology, objects, situation, decision, integration, identity},
    api,
    drain,
    cronTick,
    mails,
    lastCode,
    deadLetters: () => bus.size(DEAD_LETTER),
  };
}

/** Extracts the refresh cookie pair (`name=value`) from a response. */
export function refreshCookie(res: ApiResponse<unknown>): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const m = /(__Host-od_rt=[^;]*)/.exec(raw);
  if (!m) throw new Error(`no refresh cookie in: ${raw}`);
  return m[1];
}

/** Signs an owner up end to end; returns the access token and cookie. */
export async function signUp(
  sys: System,
  email: string,
  ip = '198.51.100.20',
): Promise<{token: string; cookie: string; tid: string}> {
  const send = await sys.api('POST', '/auth/codes', {
    ip,
    body: {email, purpose: 'signup', turnstileToken: 'ok', locale: 'zh-CN'},
  });
  if (send.status !== 202) throw new Error(`sendCode ${send.status}`);
  const res = await sys.api<{
    accessToken: string;
    me: {workspace: {tenantId: string}};
  }>('POST', '/auth/sessions', {
    ip,
    body: {email, code: sys.lastCode(email), purpose: 'signup'},
  });
  if (res.status !== 201) {
    throw new Error(`createSession ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    token: res.body.accessToken,
    cookie: refreshCookie(res),
    tid: res.body.me.workspace.tenantId,
  };
}

/** Counts rows of a table for one tenant. */
export async function rowsOf(
  db: D1Database,
  table: string,
  tid: string,
): Promise<number> {
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?1`)
    .bind(tid)
    .first<{n: number}>();
  return r?.n ?? 0;
}
