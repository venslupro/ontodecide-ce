/**
 * @fileoverview In-process wiring of all seven Workers for end-to-end tests.
 *
 * Every service is built with its real `createService` composition root over
 * Node fakes: D1 on node:sqlite (real migrations), a shared QueueBus with
 * the production batch/retry/DLQ settings, Durable Object cores over
 * in-memory SQLite, and service bindings that structured-clone arguments and
 * strip error properties like Workers RPC does. Requests enter through the
 * gateway's `createApp`, exactly as the Pages Function would forward them.
 */

import {join} from 'node:path';
import {createApp} from '../../apps/api-gateway/src/app';
import {EdgeGuardCore} from '../../apps/api-gateway/src/edge_guard_core';
import {createService as createDecision} from '../../apps/decision-engine/src/service';
import {createService as createIdentity} from '../../apps/identity-access/src/service';
import {createService as createIntegration} from '../../apps/data-integration/src/service';
import {createService as createObjects} from '../../apps/object-graph/src/service';
import {createService as createOntology} from '../../apps/ontology-manager/src/service';
import {createService as createSituation} from '../../apps/situation-awareness/src/service';
import {
  FakeDoNamespace,
  FetchMock,
  MemoryKV,
  MemorySqlStorage,
  QueueBus,
  REPO_ROOT,
  SqliteD1,
  fetcherBinding,
  rpcBinding,
  type ConsumerConfig,
} from '../../packages/testing/index';
import {SituationRoomCore} from '../../packages/situation/infrastructure/situation_room_core';
import {UsageGuardCore} from '../../packages/situation/infrastructure/usage_guard_core';
import {
  FixedClock,
  silentLogger,
  type ServiceModule,
} from '../../packages/shared-kernel/index';

export const ADMIN_EMAIL = 'admin@ontodecide.local';
export const ADMIN_PASSWORD = 'Admin12345!';
const JWT_SECRET = 'k1:e2e-jwt-secret-0123456789abcdef';
const APPROVAL_SECRET = 'e2e-approval-secret';

function d1(db: string): SqliteD1 {
  return new SqliteD1().migrate(join(REPO_ROOT, 'migrations', db));
}

/** Options for {@link createHarness}. */
export interface HarnessOptions {
  /** Extra overrides for decision-engine (e.g. a fake LLM). */
  decisionOverrides?: Record<string, unknown>;
}

/** Builds the whole system in-process. */
export function createHarness(opts: HarnessOptions = {}) {
  const clock = new FixedClock('2026-09-24T08:00:00Z');
  const bus = new QueueBus();
  const fetchMock = new FetchMock();
  const dbs = {
    identity: d1('identity'),
    ontology: d1('ontology'),
    integration: d1('integration'),
    object: d1('object'),
    situation: d1('situation'),
    decision: d1('decision'),
  };
  const common = {clock, logger: silentLogger};
  const svc: Record<string, ServiceModule<object>> = {};
  const bind = <T extends object>(name: string): T =>
    rpcBinding(() => svc[name].rpc as T);

  const rooms = new FakeDoNamespace(
    () => new SituationRoomCore(new MemorySqlStorage(), undefined, clock),
  );
  const usageGuard = new FakeDoNamespace(
    () => new UsageGuardCore(new MemorySqlStorage(), {clock}),
  );
  const edgeGuard = new FakeDoNamespace(
    () =>
      new EdgeGuardCore(new MemorySqlStorage(), () => clock.now().getTime()),
  );

  svc.identity = createIdentity(
    {
      IDENTITY_DB: dbs.identity.asD1(),
      JWT_SECRET,
      BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
      BOOTSTRAP_TENANT_NAME: 'E2E',
    },
    {...common, pbkdf2Iterations: 1000},
  );
  svc.ontology = createOntology(
    {ONTOLOGY_DB: dbs.ontology.asD1(), SCHEMA_CACHE: new MemoryKV().asKV()},
    common,
  );
  svc.integration = createIntegration(
    {
      INTEGRATION_DB: dbs.integration.asD1(),
      ONTOLOGY: bind('ontology'),
      INGEST_QUEUE: bus.sender('ingest'),
      OBJECT_WRITES_QUEUE: bus.sender('object-writes'),
      CONNECTOR_ENC_KEY: 'e2e-connector-key',
    },
    {...common, fetch: fetchMock.fetch},
  );
  svc.objects = createObjects(
    {
      OBJECT_DB: dbs.object.asD1(),
      ONTOLOGY: bind('ontology'),
      INTEGRATION: bind('integration'),
      GRAPH_SYNC_QUEUE: bus.sender('graph-sync'),
      SITUATION_EVENTS_QUEUE: bus.sender('situation-events'),
      APPROVAL_SECRET,
      WRITEBACK_SECRET: 'e2e-writeback',
    },
    {...common, fetch: fetchMock.fetch},
  );
  svc.situation = createSituation(
    {
      SITUATION_DB: dbs.situation.asD1(),
      SITUATION_ROOM: rooms.asNamespace(),
      USAGE_GUARD: usageGuard.asNamespace(),
      OBJECTS: bind('objects'),
      DECISION_JOBS_QUEUE: bus.sender('decision-jobs'),
      INGEST_QUEUE: bus.sender('ingest'),
      OBJECT_WRITES_QUEUE: bus.sender('object-writes'),
      GRAPH_SYNC_QUEUE: bus.sender('graph-sync'),
      SITUATION_EVENTS_QUEUE: bus.sender('situation-events'),
    },
    common,
  );
  svc.decision = createDecision(
    {
      DECISION_DB: dbs.decision.asD1(),
      OBJECTS: bind('objects'),
      SITUATION: bind('situation'),
      ONTOLOGY: bind('ontology'),
      DECISION_JOBS_QUEUE: bus.sender('decision-jobs'),
      APPROVAL_SECRET,
      LLM_CHAIN: 'workers-ai,gemini,groq',
    },
    {...common, fetch: fetchMock.fetch, ...(opts.decisionOverrides ?? {})},
  );

  const gateway = createApp(
    {
      IDENTITY: bind('identity'),
      ONTOLOGY: bind('ontology'),
      INTEGRATION: bind('integration'),
      OBJECTS: bind('objects'),
      SITUATION: fetcherBinding(
        req => svc.situation.fetch!(req),
        rpcBinding(() => svc.situation.rpc),
      ),
      DECISION: bind('decision'),
      EDGE_GUARD: edgeGuard.asNamespace(),
      CONFIG: new MemoryKV().asKV(),
      JWT_SECRET,
      ENVIRONMENT: 'test',
      APP_VERSION: 'e2e',
      COOKIE_SECURE: 'false',
    } as never,
    common,
  );

  const consumer = (
    name: string,
    batch: number,
    retries: number,
  ): ConsumerConfig => ({
    handler: b => svc[name].queue!(b),
    maxBatchSize: batch,
    maxRetries: retries,
    deadLetterQueue: undefined,
  });
  const dlq = (): ConsumerConfig => consumer('situation', 10, 1);
  const consumers: Record<string, ConsumerConfig> = {
    ingest: {...consumer('integration', 4, 3), deadLetterQueue: 'ingest-dlq'},
    'object-writes': {
      ...consumer('objects', 4, 3),
      deadLetterQueue: 'object-writes-dlq',
    },
    'graph-sync': {
      ...consumer('objects', 10, 5),
      deadLetterQueue: 'graph-sync-dlq',
    },
    'situation-events': {
      ...consumer('situation', 10, 3),
      deadLetterQueue: 'situation-events-dlq',
    },
    'decision-jobs': {
      ...consumer('decision', 5, 3),
      deadLetterQueue: 'decision-jobs-dlq',
    },
    'ingest-dlq': dlq(),
    'object-writes-dlq': dlq(),
    'graph-sync-dlq': dlq(),
    'situation-events-dlq': dlq(),
    'decision-jobs-dlq': dlq(),
  };

  let token = '';
  let cookie = '';

  /** Calls the public API through the gateway. */
  async function api<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{status: number; body: T; headers: Headers}> {
    const res = await gateway.fetch(
      new Request(`http://ontodecide-ce.pages.dev/api/v1${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'accept-language': 'en-US',
          ...(token ? {authorization: `Bearer ${token}`} : {}),
          ...(cookie ? {cookie} : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    return {
      status: res.status,
      body: (text ? JSON.parse(text) : null) as T,
      headers: res.headers,
    };
  }

  /** Like {@link api} but throws on non-2xx. */
  async function ok<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const r = await api<T>(method, path, body, headers);
    if (r.status >= 400) {
      throw new Error(
        `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`,
      );
    }
    return r.body;
  }

  return {
    clock,
    bus,
    dbs,
    svc,
    rooms,
    fetchMock,
    gateway,
    api,
    ok,
    /** Delivers queued messages until every queue is empty. */
    drain: () => bus.drain(consumers),
    /** Runs a service's cron handler. */
    cron: (service: string, cronExpr: string) =>
      svc[service].scheduled!(cronExpr, clock.now()),
    setToken: (t: string) => {
      token = t;
    },
    clearAuth: () => {
      token = '';
      cookie = '';
    },
  };
}

/** A running harness. */
export type Harness = ReturnType<typeof createHarness>;
