import {describe, expect, it} from 'vitest';
import type {
  IntegrationRpc,
  WriteResult,
} from '@ontodecide/integration/contract';
import {signVoucher} from '@ontodecide/object-graph/contract';
import type {
  GraphSyncMsg,
  ObjectGraphRpc,
  SituationEventMsg,
} from '@ontodecide/object-graph/contract';
import type {CompiledModel, OntologyRpc} from '@ontodecide/ontology/contract';
import {
  AppError,
  FixedClock,
  hmacSha256Hex,
  silentLogger,
} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid, Role} from '@ontodecide/shared-kernel';
import {
  FetchMock,
  QueueBus,
  SqliteD1,
  createTestD1,
  rpcBinding,
  testCtx,
} from '@ontodecide/testing';
import type {Env} from './env';
import {createService} from './service';
import {
  cmd,
  materialCmds,
  productCmds,
  supplierCmds,
  supplyChainModel,
  writeMsg,
} from './test_fixtures';
import type {ModelOptions} from './test_fixtures';

const SECRET = 'approval-secret';

interface Harness {
  env: Env;
  db: SqliteD1;
  bus: QueueBus;
  clock: FixedClock;
  fetchMock: FetchMock;
  rpc: ObjectGraphRpc;
  svc: ReturnType<typeof createService>;
  reports: {jobId: string; seq: number; last: boolean; r: WriteResult}[];
  integration: {failNext: number};
  setModel(opts: ModelOptions): void;
  send(msg: unknown): Promise<void>;
  sit(): SituationEventMsg[];
  sync(): GraphSyncMsg[];
  rid(type: string, pk: string, tenant?: string): Promise<Rid>;
  ctx(role?: Role, extra?: Partial<CallCtx>): CallCtx;
}

function harness(envExtra: Partial<Env> = {}): Harness {
  const d1 = createTestD1('object');
  const db = d1 as unknown as SqliteD1;
  const bus = new QueueBus();
  const clock = new FixedClock('2026-09-24T00:00:00Z');
  const fetchMock = new FetchMock();
  const reports: Harness['reports'] = [];
  const integrationState = {failNext: 0};
  let modelOpts: ModelOptions = {};
  const ontology = {
    getActiveModel: async (ctx: CallCtx): Promise<CompiledModel> =>
      supplyChainModel(ctx.tenantId, modelOpts),
  };
  const integration = {
    reportWriteResult: async (
      _ctx: CallCtx,
      jobId: string,
      seq: number,
      last: boolean,
      r: WriteResult,
    ) => {
      if (integrationState.failNext > 0) {
        integrationState.failNext--;
        throw new AppError('UPSTREAM_FAILED', 'integration down');
      }
      reports.push({jobId, seq, last, r});
    },
  };
  const env: Env = {
    OBJECT_DB: d1,
    ONTOLOGY: rpcBinding(ontology as unknown as OntologyRpc),
    INTEGRATION: rpcBinding(integration as unknown as IntegrationRpc),
    GRAPH_SYNC_QUEUE: bus.sender('graph-sync'),
    SITUATION_EVENTS_QUEUE: bus.sender('situation-events'),
    APPROVAL_SECRET: SECRET,
    WRITEBACK_SECRET: 'wb-secret',
    ...envExtra,
  };
  const svc = createService(env, {
    clock,
    logger: silentLogger,
    fetch: fetchMock.fetch,
  });
  const rpc = rpcBinding(svc.rpc);
  const writes = bus.sender('object-writes');
  const h: Harness = {
    env,
    db,
    bus,
    clock,
    fetchMock,
    rpc,
    svc,
    reports,
    integration: integrationState,
    setModel: opts => {
      modelOpts = opts;
    },
    send: async msg => {
      await writes.send(msg);
      await bus.drain({
        'object-writes': {
          handler: b => svc.queue!(b),
          maxBatchSize: 4,
          maxRetries: 3,
        },
      });
    },
    sit: () => bus.peek('situation-events') as SituationEventMsg[],
    sync: () => bus.peek('graph-sync') as GraphSyncMsg[],
    rid: async (type, pk, tenant = 't1') => {
      const row = db.raw
        .prepare(
          'SELECT rid FROM og_object WHERE tenant_id = ? AND object_type = ? AND primary_key = ?',
        )
        .get(tenant, type, pk) as {rid: string} | undefined;
      if (!row) throw new Error(`missing ${type}/${pk}`);
      return row.rid as Rid;
    },
    ctx: (role = 'Admin', extra = {}) => testCtx({role, ...extra}),
  };
  return h;
}

async function seeded(envExtra: Partial<Env> = {}): Promise<Harness> {
  const h = harness(envExtra);
  const ctx = h.ctx();
  await h.send(writeMsg(ctx, 'job-sup', supplierCmds()));
  await h.send(writeMsg(ctx, 'job-mat', materialCmds()));
  await h.send(writeMsg(ctx, 'job-prod', productCmds()));
  return h;
}

async function codeOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return AppError.from(e);
  }
  throw new Error('expected rejection');
}

function count(
  db: SqliteD1,
  sql: string,
  ...params: (string | number)[]
): number {
  return Number((db.raw.prepare(sql).get(...params) as {n: number}).n);
}

describe('object-graph service: upsert (object-writes)', () => {
  it('creates stub objects for link targets and fills them later', async () => {
    const h = harness();
    const ctx = h.ctx();
    await h.send(writeMsg(ctx, 'job-sup', supplierCmds()));
    // Reads + one bulked batch + inbox/outbox bookkeeping.
    expect(h.db.queries).toBeLessThanOrEqual(15);
    expect(h.reports[0]).toMatchObject({
      jobId: 'job-sup',
      seq: 0,
      last: true,
      r: {upserted: 3, merged: 0, skipped: 0, rejected: []},
    });
    const m1 = await h.rpc.getObject(ctx, await h.rid('Material', 'M1'));
    expect(m1).toMatchObject({
      title: 'M1',
      props: {materialId: 'M1'},
      provenance: {},
    });
    expect(
      count(
        h.db,
        "SELECT COUNT(*) AS n FROM og_link WHERE link_type = 'supplies'",
      ),
    ).toBe(3);

    await h.send(writeMsg(ctx, 'job-mat', materialCmds()));
    expect(h.reports[1].r).toEqual({
      upserted: 2,
      merged: 0,
      skipped: 0,
      rejected: [],
    });
    const filled = await h.rpc.getObject(ctx, await h.rid('Material', 'M1'));
    expect(filled).toMatchObject({
      title: 'Steel',
      version: 2,
      props: {name: 'Steel'},
    });
    // Products are stubs until the product source arrives.
    expect(
      (await h.rpc.getObject(ctx, await h.rid('Product', 'P2')))?.title,
    ).toBe('P2');
    await h.send(writeMsg(ctx, 'job-prod', productCmds()));
    expect(
      (await h.rpc.getObject(ctx, await h.rid('Product', 'P2')))?.title,
    ).toBe('Gadget');
    expect(count(h.db, 'SELECT COUNT(*) AS n FROM og_object')).toBe(7);
  });

  it('rejects invalid records and reports them', async () => {
    const h = harness();
    const ctx = h.ctx();
    await h.send(
      writeMsg(ctx, 'job-bad', [
        cmd('Nope', 'X', {}, {row: 1}),
        cmd('Supplier', 'S9', {riskScore: 'abc', name: 'Z'}, {row: 2}),
        cmd('Supplier', 'S8', {riskScore: 1}, {row: 3}),
        cmd(
          'Supplier',
          'S7',
          {name: 'Ok'},
          {row: 4, links: [{type: 'usedIn', toType: 'Product', toKey: 'P'}]},
        ),
        cmd('Supplier', 'S6', {name: 'Fine'}, {row: 5}),
      ]),
    );
    expect(h.reports[0].r.upserted).toBe(1);
    expect(h.reports[0].r.rejected.map(r => [r.row, r.code])).toEqual([
      [1, 'UNKNOWN_TYPE'],
      [2, 'VALIDATION_FAILED'],
      [4, 'LINK_INVALID'],
      [3, 'VALIDATION_FAILED'],
    ]);
  });

  it('re-sending the same message is a no-op (inbox)', async () => {
    const h = await seeded();
    const events = count(h.db, 'SELECT COUNT(*) AS n FROM domain_event');
    const sent = h.bus.size('situation-events');
    await h.send(writeMsg(h.ctx(), 'job-sup', supplierCmds()));
    expect(h.reports).toHaveLength(3);
    expect(count(h.db, 'SELECT COUNT(*) AS n FROM domain_event')).toBe(events);
    expect(h.bus.size('situation-events')).toBe(sent);
  });

  it('a reportWriteResult failure is retried without re-writing data', async () => {
    const h = harness();
    h.integration.failNext = 1;
    await h.send(writeMsg(h.ctx(), 'job-sup', supplierCmds()));
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0].r.upserted).toBe(3);
    expect(count(h.db, 'SELECT COUNT(*) AS n FROM og_object')).toBe(5);
    expect(
      count(h.db, 'SELECT COUNT(*) AS n FROM og_object WHERE version > 1'),
    ).toBe(0);
    expect(
      count(
        h.db,
        "SELECT COUNT(*) AS n FROM domain_event WHERE type = 'ObjectsUpserted'",
      ),
    ).toBe(1);
  });

  it('skips unchanged records and merges changed ones with provenance history', async () => {
    const h = await seeded();
    const ctx = h.ctx();
    const before = h.bus.size('situation-events');
    await h.send(writeMsg(ctx, 'job-sup-2', supplierCmds()));
    expect(h.reports[3].r).toEqual({
      upserted: 0,
      merged: 0,
      skipped: 3,
      rejected: [],
    });
    const newEvents = h.sit().slice(before);
    expect(newEvents.map(e => e.kind)).toEqual(['JobFinished']);

    const changed = supplierCmds()[0];
    changed.props.riskScore = 90;
    changed.provenance = {
      ...changed.provenance,
      ingestedAt: '2026-09-25T00:00:00.000Z',
      recordRef: 'row-9',
    };
    await h.send(writeMsg(ctx, 'job-sup-3', [changed]));
    expect(h.reports[4].r).toEqual({
      upserted: 0,
      merged: 1,
      skipped: 0,
      rejected: [],
    });
    const s1 = await h.rid('Supplier', 'S1');
    const obj = await h.rpc.getObject(ctx, s1);
    expect(obj).toMatchObject({version: 2, props: {riskScore: 90}});
    const lineage = await h.rpc.lineage(ctx, s1);
    expect(lineage.props.riskScore.value).toBe(90);
    expect(lineage.props.riskScore.current?.recordRef).toBe('row-9');
    expect(lineage.props.riskScore.history).toEqual([
      expect.objectContaining({value: 80, recordRef: 'row-1'}),
    ]);
    const evt = h
      .sit()
      .filter(e => e.kind === 'ObjectsUpserted')
      .at(-1);
    expect(evt?.changes).toEqual([
      expect.objectContaining({
        rid: s1,
        changed: ['riskScore'],
        after: expect.objectContaining({riskScore: 90}),
      }),
    ]);
    // Index follows the change.
    const top = await h.rpc.listObjects(ctx, 'Supplier', {
      filter: {op: 'gte', prop: 'riskScore', value: 85},
    });
    expect(top.items.map(i => i.primaryKey)).toEqual(['S1']);
  });

  it('dispatches the outbox to situation-events and graph-sync', async () => {
    const h = harness();
    await h.send(writeMsg(h.ctx(), 'job-sup', supplierCmds(), {last: true}));
    const sit = h.sit();
    expect(sit.map(e => e.kind)).toEqual(['ObjectsUpserted', 'JobFinished']);
    const up = sit[0];
    expect(up.tenantId).toBe('t1');
    expect(up.correlationId).toBe('corr-1');
    expect(up.changes).toHaveLength(5);
    expect(up.changes.find(c => c.title === 'Acme Metals')).toMatchObject({
      type: 'Supplier',
      after: expect.objectContaining({
        riskScore: 80,
        contactEmail: 'acme@example.com',
      }),
    });
    expect(up.usage?.[0].resource).toBe('d1.rowsWritten');
    expect(up.usage?.[0].n).toBeGreaterThan(10);
    expect(sit[1].job).toEqual({jobId: 'job-sup'});

    const [sync] = h.sync();
    expect(sync.tenantId).toBe('t1');
    expect(sync.upserts).toHaveLength(5);
    const s1 = sync.upserts.find(u => u.title === 'Acme Metals')!;
    expect(s1.idx).toEqual({
      name: 'Acme Metals',
      country: 'CN',
      riskScore: 80,
      capacity: 100,
      status: 'active',
    });
    expect(sync.links).toHaveLength(3);
    expect(sync.links.every(l => l.op === 'merge')).toBe(true);
    expect(
      sync.links.find(l => l.src === s1.rid && l.weight === 0.6),
    ).toBeDefined();
    expect(
      count(
        h.db,
        'SELECT COUNT(*) AS n FROM domain_event WHERE dispatched_at IS NULL',
      ),
    ).toBe(0);
  });

  it('cron re-dispatches undispatched outbox rows and purges old ones', async () => {
    const h = harness();
    const failing = {
      send: async () => {
        throw new Error('queue down');
      },
      sendBatch: async () => {
        throw new Error('queue down');
      },
    };
    h.env.SITUATION_EVENTS_QUEUE = failing;
    const svc = createService(h.env, {clock: h.clock, logger: silentLogger});
    const writes = h.bus.sender('object-writes');
    await writes.send(writeMsg(h.ctx(), 'job-sup', supplierCmds()));
    await h.bus.drain({'object-writes': {handler: b => svc.queue!(b)}});
    expect(
      count(
        h.db,
        'SELECT COUNT(*) AS n FROM domain_event WHERE dispatched_at IS NULL',
      ),
    ).toBe(3);
    // Too recent: nothing re-dispatched yet.
    await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    expect(
      count(
        h.db,
        'SELECT COUNT(*) AS n FROM domain_event WHERE dispatched_at IS NULL',
      ),
    ).toBe(3);
    h.clock.advance(2 * 60_000);
    await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    expect(
      count(
        h.db,
        'SELECT COUNT(*) AS n FROM domain_event WHERE dispatched_at IS NULL',
      ),
    ).toBe(0);
    expect(h.sit().map(e => e.kind)).toEqual([
      'ObjectsUpserted',
      'JobFinished',
    ]);
    h.clock.advance(8 * 86_400_000);
    await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    expect(count(h.db, 'SELECT COUNT(*) AS n FROM domain_event')).toBe(0);
  });
});

describe('object-graph service: reads', () => {
  it('lists with indexed filter, sort and cursor; non-indexed filters in memory', async () => {
    const h = await seeded();
    const ctx = h.ctx('Viewer');
    const q = {
      filter: {op: 'gte' as const, prop: 'riskScore', value: 40},
      orderBy: [{prop: 'riskScore', dir: 'desc' as const}],
      limit: 1,
    };
    const p1 = await h.rpc.listObjects(ctx, 'Supplier', q);
    expect(p1.items.map(i => i.primaryKey)).toEqual(['S1']);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await h.rpc.listObjects(ctx, 'Supplier', {
      ...q,
      cursor: p1.nextCursor!,
    });
    expect(p2.items.map(i => i.primaryKey)).toEqual(['S3']);
    expect(p2.nextCursor).toBeNull();

    const all = await h.rpc.listObjects(ctx, 'Supplier', {
      orderBy: [{prop: 'name', dir: 'asc'}],
    });
    expect(all.items.map(i => i.title)).toEqual([
      'Acme Metals',
      'Beta Parts',
      'Gamma Supply',
    ]);

    const mem = await h.rpc.listObjects(ctx, 'Supplier', {
      filter: {
        op: 'and',
        args: [
          {op: 'gt', prop: 'onTimeRate', value: 0.8},
          {op: 'eq', prop: 'status', value: 'active'},
        ],
      },
      orderBy: [{prop: 'onTimeRate', dir: 'desc'}],
    });
    expect(mem.items.map(i => i.primaryKey)).toEqual(['S2', 'S3']);

    const strs = await h.rpc.listObjects(ctx, 'Supplier', {
      filter: {
        op: 'or',
        args: [
          {op: 'in', prop: 'country', values: ['CN', 'DE']},
          {op: 'contains', prop: 'name', value: 'gamma'},
        ],
      },
    });
    expect(strs.items.map(i => i.primaryKey).sort()).toEqual([
      'S1',
      'S2',
      'S3',
    ]);
    const neq = await h.rpc.listObjects(ctx, 'Supplier', {
      filter: {op: 'neq', prop: 'country', value: 'CN'},
    });
    expect(neq.items.map(i => i.primaryKey).sort()).toEqual(['S2', 'S3']);

    expect(
      (
        await codeOf(
          h.rpc.listObjects(ctx, 'Supplier', {
            filter: {op: 'eq', prop: 'contactEmail', value: 'x'},
          }),
        )
      ).code,
    ).toBe('FORBIDDEN');
    expect((await codeOf(h.rpc.listObjects(ctx, 'Nope'))).code).toBe(
      'OBJECT_SET_INVALID',
    );
    expect(
      (
        await codeOf(
          h.rpc.listObjects(ctx, 'Supplier', {
            filter: {op: 'eq', prop: 'bogus', value: 1},
          }),
        )
      ).code,
    ).toBe('OBJECT_SET_INVALID');
    expect(
      (await codeOf(h.rpc.listObjects(ctx, 'Supplier', {cursor: '%%%'}))).code,
    ).toBe('OBJECT_SET_INVALID');
  });

  it('refuses in-memory filtering above 200 candidates', async () => {
    const h = harness();
    const cmds = Array.from({length: 201}, (_, i) =>
      cmd(
        'Supplier',
        `X${i}`,
        {name: `Supplier ${i}`, onTimeRate: i / 201},
        {row: i},
      ),
    );
    for (let i = 0; i < cmds.length; i += 50) {
      await h.send(
        writeMsg(h.ctx(), 'job-many', cmds.slice(i, i + 50), {seq: i}),
      );
    }
    expect(count(h.db, 'SELECT COUNT(*) AS n FROM og_object')).toBe(201);
    const err = await codeOf(
      h.rpc.listObjects(h.ctx(), 'Supplier', {
        filter: {op: 'gt', prop: 'onTimeRate', value: 0.5},
      }),
    );
    expect(err.code).toBe('OBJECT_SET_INVALID');
    const page = await h.rpc.listObjects(h.ctx(), 'Supplier', {limit: 200});
    expect(page.items).toHaveLength(200);
    expect(page.nextCursor).toBeTruthy();
    expect(
      await h.rpc.aggregate(h.ctx(), {
        objectSet: {objectType: 'Supplier'},
        fn: 'count',
      }),
    ).toBe(201);
  });

  it('evaluates object sets with Search Around and saved sets', async () => {
    const h = await seeded();
    const ctx = h.ctx();
    const def = {
      objectType: 'Supplier',
      filter: {op: 'eq' as const, prop: 'name', value: 'Acme Metals'},
      searchAround: [
        {link: 'supplies', direction: 'out' as const},
        {link: 'usedIn', direction: 'out' as const},
      ],
      orderBy: [{prop: 'dailyDemand', dir: 'desc' as const}],
    };
    const res = await h.rpc.evaluateObjectSet(ctx, def);
    expect(res.items.map(i => i.title)).toEqual(['Widget', 'Gadget']);
    const back = await h.rpc.evaluateObjectSet(ctx, {
      objectType: 'Product',
      filter: {op: 'eq', prop: 'name', value: 'Gadget'},
      searchAround: [{link: 'usedIn', direction: 'in'}],
    });
    expect(back.items.map(i => i.primaryKey)).toEqual(['M2']);
    expect(
      (
        await codeOf(
          h.rpc.evaluateObjectSet(ctx, {
            ...def,
            searchAround: [
              ...def.searchAround,
              {link: 'usedIn', direction: 'out'},
            ],
          }),
        )
      ).code,
    ).toBe('OBJECT_SET_INVALID');
    expect(
      (
        await codeOf(
          h.rpc.evaluateObjectSet(ctx, {
            objectType: 'Supplier',
            searchAround: [{link: 'usedIn', direction: 'out'}],
          }),
        )
      ).code,
    ).toBe('OBJECT_SET_INVALID');

    expect(
      (
        await codeOf(
          h.rpc.saveObjectSet(h.ctx('Viewer'), {name: 'x', definition: def}),
        )
      ).code,
    ).toBe('FORBIDDEN');
    const saved = await h.rpc.saveObjectSet(h.ctx('Operator'), {
      name: 'Acme products',
      definition: def,
    });
    expect(saved).toMatchObject({name: 'Acme products', createdBy: 'u1'});
    const updated = await h.rpc.saveObjectSet(h.ctx('Operator'), {
      id: saved.id,
      name: 'Renamed',
      definition: def,
    });
    expect(updated.id).toBe(saved.id);
    expect((await h.rpc.listObjectSets(ctx)).map(s => s.name)).toEqual([
      'Renamed',
    ]);
    const evaluated = await h.rpc.evaluateSavedObjectSet(ctx, saved.id, {
      limit: 1,
    });
    expect(evaluated.items.map(i => i.title)).toEqual(['Widget']);
    expect(evaluated.nextCursor).toBeTruthy();
    expect(
      (await codeOf(h.rpc.evaluateSavedObjectSet(ctx, 'missing'))).code,
    ).toBe('NOT_FOUND');
  });

  it('aggregates for KPIs', async () => {
    const h = await seeded();
    const ctx = h.ctx();
    const agg = (
      objectSet: object,
      fn: 'count' | 'sum' | 'avg' | 'min' | 'max',
      prop?: string,
    ) => h.rpc.aggregate(ctx, {objectSet: objectSet as never, fn, prop});
    expect(
      await agg(
        {
          objectType: 'Supplier',
          filter: {op: 'gte', prop: 'riskScore', value: 70},
        },
        'count',
      ),
    ).toBe(1);
    expect(await agg({objectType: 'Supplier'}, 'avg', 'riskScore')).toBeCloseTo(
      (80 + 30 + 45) / 3,
    );
    expect(await agg({objectType: 'Product'}, 'sum', 'dailyDemand')).toBe(150);
    expect(
      await agg(
        {
          objectType: 'Product',
          filter: {op: 'lt', prop: 'inventoryDays', value: 7},
        },
        'count',
      ),
    ).toBe(1);
    expect(await agg({objectType: 'Supplier'}, 'max', 'onTimeRate')).toBe(0.95);
    expect(
      await agg(
        {
          objectType: 'Supplier',
          searchAround: [{link: 'supplies', direction: 'out'}],
        },
        'count',
      ),
    ).toBe(2);
    expect((await codeOf(agg({objectType: 'Supplier'}, 'sum'))).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      (
        await codeOf(
          h.rpc.aggregate(h.ctx('Viewer'), {
            objectSet: {objectType: 'Material'},
            fn: 'sum',
            prop: 'unitCost',
          }),
        )
      ).code,
    ).toBe('FORBIDDEN');
  });

  it('getObject expands links (depth 2) and hides marked properties', async () => {
    const h = await seeded();
    const s1 = await h.rid('Supplier', 'S1');
    const viewer = h.ctx('Viewer');
    const plain = await h.rpc.getObject(viewer, s1);
    expect(plain?.props.contactEmail).toBeUndefined();
    expect(plain?.provenance.contactEmail).toBeUndefined();
    expect(plain?.hiddenProps).toEqual(['contactEmail']);
    expect(plain?.links).toBeUndefined();

    const withPii = await h.rpc.getObject(
      h.ctx('Viewer', {markings: ['PII']}),
      s1,
    );
    expect(withPii?.props.contactEmail).toBe('acme@example.com');
    expect(withPii?.hiddenProps).toBeUndefined();

    const d1 = await h.rpc.getObject(viewer, s1, {expand: 'links'});
    expect(d1?.links?.map(l => [l.type, l.direction])).toEqual([
      ['supplies', 'out'],
      ['supplies', 'out'],
    ]);
    expect(d1?.neighbors?.map(n => n.title).sort()).toEqual([
      'Copper',
      'Steel',
    ]);

    const before = (h.db as SqliteD1).queries;
    const d2 = await h.rpc.getObject(viewer, s1, {expand: 'links', depth: 2});
    expect((h.db as SqliteD1).queries - before).toBeLessThanOrEqual(4);
    expect(new Set(d2?.links?.map(l => l.type))).toEqual(
      new Set(['supplies', 'usedIn']),
    );
    expect(d2?.neighbors?.map(n => n.title).sort()).toEqual([
      'Copper',
      'Gadget',
      'Gamma Supply',
      'Steel',
      'Widget',
    ]);

    const m1 = await h.rpc.getObject(viewer, await h.rid('Material', 'M1'));
    expect(m1?.props.unitCost).toBeUndefined();
    expect(m1?.hiddenProps).toEqual(['unitCost']);
    const lineage = await h.rpc.lineage(viewer, await h.rid('Material', 'M1'));
    expect(lineage.props.unitCost).toBeUndefined();
    expect(lineage.props.name.current?.sourceId).toBe('src-Material');

    const many = await h.rpc.getObjects(viewer, [
      s1,
      await h.rid('Supplier', 'S2'),
      'ri.t2.Supplier.X' as Rid,
    ]);
    expect(many.map(o => o.primaryKey)).toEqual(['S1', 'S2']);
    expect(many[0].props.contactEmail).toBeUndefined();

    const found = await h.rpc.search(viewer, 'me', {type: 'Supplier'});
    expect(found.map(o => o.primaryKey)).toEqual(['S1']);
    expect((await h.rpc.search(viewer, 'e')).length).toBeGreaterThan(3);
    expect(
      await h.rpc.getObject(viewer, 'ri.t1.Supplier.NOPE' as Rid),
    ).toBeNull();
    expect(
      (await codeOf(h.rpc.lineage(viewer, 'ri.t1.Supplier.NOPE' as Rid))).code,
    ).toBe('OBJECT_NOT_FOUND');
  });

  it('impactSubgraph and paths', async () => {
    const h = await seeded();
    const ctx = h.ctx('Viewer');
    const s1 = await h.rid('Supplier', 'S1');
    const slice = await h.rpc.impactSubgraph(ctx, {
      rids: [s1],
      maxHops: 2,
      limit: 200,
    });
    expect(slice.degraded).toBe(false);
    const byTitle = Object.fromEntries(slice.nodes.map(n => [n.title, n.hop]));
    expect(byTitle).toEqual({
      'Acme Metals': 0,
      Steel: 1,
      Copper: 1,
      Widget: 2,
      Gadget: 2,
    });
    expect(
      slice.nodes.find(n => n.hop === 0)?.props.contactEmail,
    ).toBeUndefined();
    expect(slice.edges).toHaveLength(5);
    const onlySupplies = await h.rpc.impactSubgraph(ctx, {
      rids: [s1],
      maxHops: 2,
      limit: 200,
      linkTypes: ['supplies'],
    });
    expect(onlySupplies.nodes).toHaveLength(3);
    const limited = await h.rpc.impactSubgraph(ctx, {
      rids: [s1],
      maxHops: 2,
      limit: 2,
    });
    expect(limited.nodes).toHaveLength(2);

    const deep = await h.rpc.impactSubgraph(ctx, {
      rids: [s1],
      maxHops: 3,
      limit: 200,
    });
    expect(deep.degraded).toBe(true);
    expect(deep.nodes).toHaveLength(5);
    expect(
      (
        await codeOf(
          h.rpc.impactSubgraph(ctx, {rids: [s1], maxHops: 2, limit: 501}),
        )
      ).code,
    ).toBe('GRAPH_TOO_LARGE');

    const p1 = await h.rid('Product', 'P1');
    const paths = await h.rpc.paths(ctx, {from: s1, to: p1});
    expect(paths.degraded).toBe(false);
    expect(paths.paths[0]).toHaveLength(3);
    expect(paths.paths.length).toBeGreaterThanOrEqual(2);
    const s2 = await h.rid('Supplier', 'S2');
    expect((await h.rpc.paths(ctx, {from: s1, to: s2})).paths).toEqual([]);
    const s3 = await h.rid('Supplier', 'S3');
    expect(
      (await h.rpc.paths(ctx, {from: s1, to: s3, maxHops: 2})).paths,
    ).toHaveLength(1);
    expect(
      (
        await codeOf(
          h.rpc.paths(ctx, {from: s1, to: 'ri.t1.Product.NOPE' as Rid}),
        )
      ).code,
    ).toBe('OBJECT_NOT_FOUND');
  });

  it('isolates tenants', async () => {
    const h = await seeded();
    const other = h.ctx('Admin', {tenantId: 't2'});
    const s1 = await h.rid('Supplier', 'S1');
    expect(await h.rpc.getObject(other, s1)).toBeNull();
    expect((await h.rpc.listObjects(other, 'Supplier')).items).toEqual([]);
    expect(await h.rpc.getObjects(other, [s1])).toEqual([]);
    expect(await h.rpc.search(other, 'Acme')).toEqual([]);
    expect(
      await h.rpc.aggregate(other, {
        objectSet: {objectType: 'Supplier'},
        fn: 'count',
      }),
    ).toBe(0);
    expect(
      (
        await codeOf(
          h.rpc.applyAction(other, {
            actionType: 'flagSupplier',
            target: s1,
            params: {},
          }),
        )
      ).code,
    ).toBe('OBJECT_NOT_FOUND');
    expect(
      (
        await codeOf(
          h.rpc.impactSubgraph(other, {rids: [s1], maxHops: 1, limit: 10}),
        )
      ).code,
    ).toBe('OBJECT_NOT_FOUND');
    // Same primary key in another tenant creates a separate object.
    await h.send(
      writeMsg(other, 'job-t2', [cmd('Supplier', 'S1', {name: 'Other Acme'})]),
    );
    const t2s1 = await h.rid('Supplier', 'S1', 't2');
    expect(t2s1).not.toBe(s1);
    expect((await h.rpc.getObject(h.ctx(), s1))?.title).toBe('Acme Metals');
    expect(
      (await h.rpc.listObjects(other, 'Supplier')).items.map(i => i.title),
    ).toEqual(['Other Acme']);
  });
});

describe('object-graph service: actions', () => {
  async function voucher(
    target: Rid,
    actionType: string,
    opts: {expiresAt?: string; tenantId?: string; secret?: string} = {},
  ) {
    return signVoucher(opts.secret ?? SECRET, {
      recommendationId: 'rec-1',
      tenantId: opts.tenantId ?? 't1',
      actionType,
      target,
      expiresAt: opts.expiresAt ?? '2026-09-25T00:00:00Z',
    });
  }

  it('requires a valid approval voucher', async () => {
    const h = await seeded();
    const op = h.ctx('Operator');
    const p1 = await h.rid('Product', 'P1');
    const base = {
      actionType: 'increaseSafetyStock',
      target: p1,
      params: {days: 7},
    };
    const missing = await codeOf(h.rpc.applyAction(op, base));
    expect(missing.code).toBe('APPROVAL_REQUIRED');
    expect(missing.status).toBe(409);
    const forged = {
      ...(await voucher(p1, 'increaseSafetyStock')),
      signature: 'f'.repeat(64),
    };
    expect(
      (await codeOf(h.rpc.applyAction(op, {...base, approval: forged}))).code,
    ).toBe('APPROVAL_REQUIRED');
    const wrongSecret = await voucher(p1, 'increaseSafetyStock', {
      secret: 'other',
    });
    expect(
      (await codeOf(h.rpc.applyAction(op, {...base, approval: wrongSecret})))
        .code,
    ).toBe('APPROVAL_REQUIRED');
    const expired = await voucher(p1, 'increaseSafetyStock', {
      expiresAt: '2026-09-23T00:00:00Z',
    });
    expect(
      (await codeOf(h.rpc.applyAction(op, {...base, approval: expired}))).code,
    ).toBe('APPROVAL_REQUIRED');
    const otherTarget = await voucher(
      await h.rid('Product', 'P2'),
      'increaseSafetyStock',
    );
    expect(
      (await codeOf(h.rpc.applyAction(op, {...base, approval: otherTarget})))
        .code,
    ).toBe('APPROVAL_REQUIRED');
    const otherRec = await voucher(p1, 'increaseSafetyStock');
    expect(
      (
        await codeOf(
          h.rpc.applyAction(op, {
            ...base,
            approval: otherRec,
            recommendationId: 'rec-2',
          }),
        )
      ).code,
    ).toBe('APPROVAL_REQUIRED');

    const valid = await voucher(p1, 'increaseSafetyStock');
    const before = h.bus.size('situation-events');
    const res = await h.rpc.applyAction(op, {
      ...base,
      approval: valid,
      recommendationId: 'rec-1',
      ifMatch: 2,
    });
    expect(res).toMatchObject({
      actionType: 'increaseSafetyStock',
      rid: p1,
      version: 3,
      writebackStatus: 'NONE',
      before: {inventoryDays: 10, safetyStockDays: 5},
      after: {inventoryDays: 17, safetyStockDays: 12},
    });
    expect(res.after.revenuePerUnit).toBeUndefined();
    const evt = h
      .sit()
      .slice(before)
      .find(e => e.kind === 'ActionExecuted');
    expect(evt).toMatchObject({
      action: {
        actionLogId: res.actionLogId,
        actionType: 'increaseSafetyStock',
        recommendationId: 'rec-1',
      },
      changes: [
        expect.objectContaining({
          rid: p1,
          changed: ['inventoryDays', 'safetyStockDays'],
        }),
      ],
    });
    expect(evt?.usage?.[0].n).toBeGreaterThan(0);
    const idx = h.db.raw
      .prepare(
        "SELECT num_val FROM og_prop_index WHERE rid = ? AND prop = 'inventoryDays'",
      )
      .get(p1) as {num_val: number};
    expect(idx.num_val).toBe(17);
    // Replaying the approval is idempotent.
    const again = await h.rpc.applyAction(op, {
      ...base,
      approval: valid,
      recommendationId: 'rec-1',
      ifMatch: 2,
    });
    expect(again.actionLogId).toBe(res.actionLogId);
    const log = await h.rpc.listActionLog(h.ctx('Viewer'), {rid: p1});
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actor: 'u1',
      recommendationId: 'rec-1',
      params: {days: 7},
    });
    const lineage = await h.rpc.lineage(h.ctx(), p1);
    expect(lineage.props.inventoryDays.current?.sourceId).toBe(
      'action:increaseSafetyStock',
    );
    expect(lineage.props.inventoryDays.history[0].value).toBe(10);
  });

  it('checks role, If-Match and preconditions', async () => {
    const h = await seeded();
    const s1 = await h.rid('Supplier', 'S1');
    const p1 = await h.rid('Product', 'P1');
    const viewer = await codeOf(
      h.rpc.applyAction(h.ctx('Viewer'), {
        actionType: 'flagSupplier',
        target: s1,
        params: {},
      }),
    );
    expect(viewer.code).toBe('FORBIDDEN');
    expect(viewer.status).toBe(403);
    const conflict = await codeOf(
      h.rpc.applyAction(h.ctx('Operator'), {
        actionType: 'flagSupplier',
        target: s1,
        params: {},
        ifMatch: 7,
      }),
    );
    expect(conflict.code).toBe('VERSION_CONFLICT');
    expect(conflict.status).toBe(412);
    expect(conflict.extras.currentVersion).toBe(1);

    const approval = await signVoucher(SECRET, {
      recommendationId: 'rec-9',
      tenantId: 't1',
      actionType: 'increaseSafetyStock',
      target: p1,
      expiresAt: '2026-09-25T00:00:00Z',
    });
    const pre = await codeOf(
      h.rpc.applyAction(h.ctx('Operator', {locale: 'zh-CN'}), {
        actionType: 'increaseSafetyStock',
        target: p1,
        params: {days: 40},
        approval,
      }),
    );
    expect(pre.code).toBe('PRECONDITION_FAILED');
    expect(pre.status).toBe(422);
    expect(pre.extras.unmet).toEqual(['增加天数须在 1–30 之间']);
    expect(
      (
        await codeOf(
          h.rpc.applyAction(h.ctx('Operator'), {
            actionType: 'nope',
            target: s1,
            params: {},
          }),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(
      (
        await codeOf(
          h.rpc.applyAction(h.ctx('Operator'), {
            actionType: 'flagSupplier',
            target: p1,
            params: {},
          }),
        )
      ).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (
        await codeOf(
          h.rpc.applyAction(h.ctx('Operator'), {
            actionType: 'flagSupplier',
            target: 'ri.t1.Supplier.X' as Rid,
            params: {},
          }),
        )
      ).code,
    ).toBe('OBJECT_NOT_FOUND');

    const ok = await h.rpc.applyAction(h.ctx('Operator'), {
      actionType: 'flagSupplier',
      target: s1,
      params: {reason: 'risk'},
      ifMatch: 1,
    });
    expect(ok).toMatchObject({version: 2, after: {status: 'watch'}});
    expect(ok.after.contactEmail).toBeUndefined();
    const watch = await h.rpc.listObjects(h.ctx(), 'Supplier', {
      filter: {op: 'eq', prop: 'status', value: 'watch'},
    });
    expect(watch.items.map(i => i.primaryKey)).toEqual(['S1']);
  });

  it('switchSupplier relinks by primary key and syncs the graph', async () => {
    const h = await seeded();
    const m1 = await h.rid('Material', 'M1');
    const s1 = await h.rid('Supplier', 'S1');
    const s2 = await h.rid('Supplier', 'S2');
    const approval = await signVoucher(SECRET, {
      recommendationId: 'rec-s',
      tenantId: 't1',
      actionType: 'switchSupplier',
      target: m1,
      expiresAt: '2026-09-25T00:00:00Z',
    });
    const syncBefore = h.bus.size('graph-sync');
    const res = await h.rpc.applyAction(h.ctx('Operator'), {
      actionType: 'switchSupplier',
      target: m1,
      params: {newSupplier: 'S2'},
      approval,
    });
    expect(res.version).toBe(3);
    const links = h.db.raw
      .prepare(
        "SELECT src_rid, weight FROM og_link WHERE link_type = 'supplies' AND dst_rid = ?",
      )
      .all(m1) as {src_rid: string; weight: number}[];
    expect(links).toEqual([{src_rid: s2, weight: 0.6}]);
    const msg = h.sync().slice(syncBefore)[0];
    expect(msg.links).toEqual([
      {type: 'supplies', src: s1, dst: m1, weight: 0.6, op: 'delete'},
      {type: 'supplies', src: s2, dst: m1, weight: 0.6, op: 'merge'},
    ]);
    const unknown = await codeOf(
      h.rpc.applyAction(h.ctx('Operator'), {
        actionType: 'switchSupplier',
        target: m1,
        params: {newSupplier: 'S404'},
        approval: {
          ...approval,
          recommendationId: 'rec-s2',
          signature: (
            await signVoucher(SECRET, {...approval, recommendationId: 'rec-s2'})
          ).signature,
        },
      }),
    );
    expect(unknown.code).toBe('VALIDATION_FAILED');
  });

  it('writeback failure marks WRITEBACK_PENDING and cron retries it', async () => {
    const h = await seeded();
    h.setModel({flagWritebackUrl: 'https://erp.example.com/hook'});
    h.clock.advance(61_000); // model cache TTL
    h.fetchMock.respond(() => new Response('down', {status: 503}));
    const s1 = await h.rid('Supplier', 'S1');
    const res = await h.rpc.applyAction(h.ctx('Operator'), {
      actionType: 'flagSupplier',
      target: s1,
      params: {},
    });
    expect(res.writebackStatus).toBe('WRITEBACK_PENDING');
    expect(res.after.status).toBe('watch');
    expect((await h.rpc.getObject(h.ctx(), s1))?.props.status).toBe('watch');
    const call = h.fetchMock.calls[0];
    expect(call.url).toBe('https://erp.example.com/hook');
    expect(call.headers['idempotency-key']).toBe(res.actionLogId);
    const expected = await hmacSha256Hex(
      'wb-secret',
      `${call.headers['x-od-timestamp']}.${call.body}`,
    );
    expect(call.headers['x-od-signature']).toBe(expected);
    expect(JSON.parse(call.body)).toMatchObject({
      actionLogId: res.actionLogId,
      actionType: 'flagSupplier',
      target: s1,
    });

    // Still failing: attempts grow; then success.
    await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    let row = h.db.raw
      .prepare(
        'SELECT writeback_status, writeback_attempts FROM og_action_log WHERE id = ?',
      )
      .get(res.actionLogId) as Record<string, unknown>;
    expect(row).toEqual({
      writeback_status: 'WRITEBACK_PENDING',
      writeback_attempts: 2,
    });
    h.fetchMock.respond(() => new Response('{}', {status: 200}));
    await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    row = h.db.raw
      .prepare(
        'SELECT writeback_status, writeback_attempts FROM og_action_log WHERE id = ?',
      )
      .get(res.actionLogId) as Record<string, unknown>;
    expect(row).toEqual({writeback_status: 'SENT', writeback_attempts: 3});
    expect(h.fetchMock.calls).toHaveLength(3);
    expect(
      h.fetchMock.calls.every(
        c => c.headers['idempotency-key'] === res.actionLogId,
      ),
    ).toBe(true);

    // A successful first attempt is SENT immediately; exhausted retries are left alone.
    const s2 = await h.rid('Supplier', 'S2');
    const sent = await h.rpc.applyAction(h.ctx('Operator'), {
      actionType: 'flagSupplier',
      target: s2,
      params: {},
    });
    expect(sent.writebackStatus).toBe('SENT');
    h.fetchMock.respond(() => new Response('down', {status: 500}));
    const s3 = await h.rid('Supplier', 'S3');
    const pending = await h.rpc.applyAction(h.ctx('Operator'), {
      actionType: 'flagSupplier',
      target: s3,
      params: {},
    });
    for (let i = 0; i < 4; i++)
      await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    row = h.db.raw
      .prepare(
        'SELECT writeback_status, writeback_attempts FROM og_action_log WHERE id = ?',
      )
      .get(pending.actionLogId) as Record<string, unknown>;
    expect(row).toEqual({
      writeback_status: 'WRITEBACK_PENDING',
      writeback_attempts: 3,
    });
    const log = await h.rpc.listActionLog(h.ctx(), {});
    expect(log.map(l => l.writebackStatus).sort()).toEqual([
      'SENT',
      'SENT',
      'WRITEBACK_PENDING',
    ]);
  });
});

describe('object-graph service: entity resolution and admin', () => {
  it('suggests fuzzy merges; accepting moves links and aliases the key', async () => {
    const h = await seeded();
    const ctx = h.ctx();
    await h.send(
      writeMsg(ctx, 'job-dup', [
        cmd(
          'Supplier',
          'S4',
          {name: 'ACME Metal'},
          {
            row: 1,
            links: [{type: 'supplies', toType: 'Material', toKey: 'M3'}],
          },
        ),
      ]),
    );
    const s1 = await h.rid('Supplier', 'S1');
    const s4 = await h.rid('Supplier', 'S4');
    expect(
      (await codeOf(h.rpc.listMergeSuggestions(h.ctx('Operator')))).code,
    ).toBe('FORBIDDEN');
    const [s] = await h.rpc.listMergeSuggestions(h.ctx('Modeler'));
    expect(s).toMatchObject({
      ridA: s1,
      ridB: s4,
      titleA: 'Acme Metals',
      titleB: 'ACME Metal',
      status: 'OPEN',
    });
    expect(s.score).toBeGreaterThanOrEqual(0.92);

    const accepted = await h.rpc.resolveMergeSuggestion(
      h.ctx('Modeler'),
      s.id,
      true,
    );
    expect(accepted.status).toBe('ACCEPTED');
    expect(await h.rpc.getObject(ctx, s4)).toBeNull();
    const m3 = await h.rid('Material', 'M3');
    const linked = await h.rpc.getObject(ctx, s1, {expand: 'links'});
    expect(
      linked?.links?.some(l => l.dst === m3 && l.type === 'supplies'),
    ).toBe(true);
    expect(
      (
        await codeOf(
          h.rpc.resolveMergeSuggestion(h.ctx('Modeler'), s.id, false),
        )
      ).code,
    ).toBe('INVALID_TRANSITION');

    // Later upserts of S4 resolve to S1 through the alias.
    await h.send(
      writeMsg(ctx, 'job-dup-2', [
        cmd(
          'Supplier',
          'S4',
          {name: 'ACME Metal', riskScore: 81},
          {provenance: {ingestedAt: '2026-09-26T00:00:00Z'}},
        ),
      ]),
    );
    expect(
      count(
        h.db,
        "SELECT COUNT(*) AS n FROM og_object WHERE object_type = 'Supplier'",
      ),
    ).toBe(3);
    expect((await h.rpc.getObject(ctx, s1))?.props.riskScore).toBe(81);
    expect(h.reports.at(-1)?.r.merged).toBe(1);

    // Rejecting only changes the status.
    await h.send(
      writeMsg(ctx, 'job-dup-3', [cmd('Supplier', 'S5', {name: 'Beta Part'})]),
    );
    const open = (await h.rpc.listMergeSuggestions(h.ctx('Modeler'))).find(
      x => x.status === 'OPEN',
    )!;
    expect(open.titleA).toBe('Beta Parts');
    expect(
      (await h.rpc.resolveMergeSuggestion(h.ctx('Modeler'), open.id, false))
        .status,
    ).toBe('REJECTED');
    expect(await h.rpc.getObject(ctx, open.ridB)).not.toBeNull();
  });

  it('resolves aliases by source external key', async () => {
    const h = harness();
    const ctx = h.ctx();
    await h.send(
      writeMsg(ctx, 'j1', [
        cmd(
          'Supplier',
          'S1',
          {name: 'Acme'},
          {source: 'erp', externalKey: 'ERP-1'},
        ),
      ]),
    );
    await h.send(
      writeMsg(ctx, 'j2', [
        cmd(
          'Supplier',
          'ACME-001',
          {name: 'Acme', country: 'CN'},
          {
            source: 'erp',
            externalKey: 'ERP-1',
            provenance: {ingestedAt: '2026-09-25T00:00:00Z'},
          },
        ),
      ]),
    );
    expect(count(h.db, 'SELECT COUNT(*) AS n FROM og_object')).toBe(1);
    const s1 = await h.rid('Supplier', 'S1');
    expect((await h.rpc.getObject(ctx, s1))?.props.country).toBe('CN');
  });

  it('rebuilds indexes when the index plan changes', async () => {
    const h = await seeded();
    expect(
      (
        await codeOf(
          h.rpc.onOntologyPublished(h.ctx('Operator'), {
            api: 'supplyChain',
            version: '1.1.0',
            breaking: false,
          }),
        )
      ).code,
    ).toBe('FORBIDDEN');
    const first = await h.rpc.onOntologyPublished(h.ctx('Modeler'), {
      api: 'supplyChain',
      version: '1.0.0',
      breaking: false,
    });
    expect(first.reindexed).toBe(7);
    h.setModel({version: '1.1.0', extraIndexed: {Supplier: ['onTimeRate']}});
    const second = await h.rpc.onOntologyPublished(h.ctx('Modeler'), {
      api: 'supplyChain',
      version: '1.1.0',
      breaking: false,
    });
    expect(second.reindexed).toBe(3);
    expect(
      count(
        h.db,
        "SELECT COUNT(*) AS n FROM og_prop_index WHERE prop = 'onTimeRate'",
      ),
    ).toBe(3);
    expect(
      h.db.raw
        .prepare(
          "SELECT value FROM og_meta WHERE tenant_id = 't1' AND key = 'modelVersion'",
        )
        .get(),
    ).toEqual({value: '1.1.0'});
    h.setModel({version: '1.2.0'});
    await h.rpc.onOntologyPublished(h.ctx('Modeler'), {
      api: 'supplyChain',
      version: '1.2.0',
      breaking: true,
    });
    expect(
      count(
        h.db,
        "SELECT COUNT(*) AS n FROM og_prop_index WHERE prop = 'onTimeRate'",
      ),
    ).toBe(0);
  });

  it('rebuildProjection enqueues graph-sync chunks (Admin only)', async () => {
    const h = await seeded();
    expect((await codeOf(h.rpc.rebuildProjection(h.ctx('Modeler')))).code).toBe(
      'FORBIDDEN',
    );
    const before = h.bus.size('graph-sync');
    const res = await h.rpc.rebuildProjection(h.ctx());
    expect(res.queued).toBe(2);
    const msgs = h.sync().slice(before);
    expect(msgs[0].upserts).toHaveLength(7);
    expect(msgs[1].links).toHaveLength(6);
  });

  it('graph-sync consumer is a no-op without Neo4j', async () => {
    const h = await seeded();
    await h.bus.drain({
      'graph-sync': {handler: b => h.svc.queue!(b), maxRetries: 5},
    });
    expect(h.bus.size('graph-sync')).toBe(0);
    expect(h.fetchMock.calls).toHaveLength(0);
  });
});

describe('object-graph service: Neo4j', () => {
  const neo = {
    FEATURE_NEO4J: 'true',
    NEO4J_URL: 'neo4j+s://abc.databases.neo4j.io',
    NEO4J_USER: 'neo4j',
    NEO4J_PASSWORD: 'pw',
    NEO4J_DATABASE: 'neo4j',
  };

  it('writes graph-sync messages through the Query API and sends a daily heartbeat', async () => {
    const h = await seeded(neo);
    h.fetchMock.respond(() =>
      Response.json({data: {fields: [], values: []}}, {status: 202}),
    );
    await h.bus.drain({
      'graph-sync': {handler: b => h.svc.queue!(b), maxRetries: 5},
    });
    const calls = h.fetchMock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(
      calls.every(
        c => c.url === 'https://abc.databases.neo4j.io/db/neo4j/query/v2',
      ),
    ).toBe(true);
    expect(calls[0].headers.authorization).toBe(`Basic ${btoa('neo4j:pw')}`);
    const bodies = calls.map(
      c =>
        JSON.parse(c.body) as {
          statement: string;
          parameters: Record<string, unknown>;
        },
    );
    const supplierMerge = bodies.find(b =>
      b.statement.includes('SET n:`Supplier`'),
    )!;
    expect(supplierMerge.parameters.tenant).toBe('t1');
    expect(
      bodies.some(b => b.statement.includes('MERGE (a)-[r:`supplies`]->(b)')),
    ).toBe(true);
    expect(bodies.every(b => !b.statement.includes('apoc'))).toBe(true);

    const n = calls.length;
    await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    const beats = h.fetchMock.calls
      .slice(n)
      .filter(c => c.body.includes('Checkpoint'));
    expect(beats).toHaveLength(1);
    h.clock.advance(86_400_000);
    await h.svc.scheduled!('*/15 * * * *', h.clock.now());
    expect(
      h.fetchMock.calls.slice(n).filter(c => c.body.includes('Checkpoint')),
    ).toHaveLength(2);
  });

  it('serves 3-hop impact from Neo4j and degrades to D1 on failure', async () => {
    const h = await seeded(neo);
    const s1 = await h.rid('Supplier', 'S1');
    const m1 = await h.rid('Material', 'M1');
    const p1 = await h.rid('Product', 'P1');
    h.fetchMock.respond(() =>
      Response.json(
        {
          data: {
            fields: ['src', 'dst', 'type', 'weight'],
            values: [
              [s1, m1, 'supplies', 0.6],
              [m1, p1, 'usedIn', null],
            ],
          },
        },
        {status: 202},
      ),
    );
    const deep = await h.rpc.impactSubgraph(h.ctx(), {
      rids: [s1],
      maxHops: 3,
      limit: 100,
    });
    expect(deep.degraded).toBe(false);
    expect(deep.nodes.map(n => [n.title, n.hop])).toEqual([
      ['Acme Metals', 0],
      ['Steel', 1],
      ['Widget', 2],
    ]);
    const stmt = JSON.parse(h.fetchMock.calls.at(-1)!.body).statement as string;
    expect(stmt).toContain('*1..3');

    h.fetchMock.respond(
      () =>
        new Response('{"errors":[{"code":"Neo.DatabaseError"}]}', {
          status: 500,
        }),
    );
    const degraded = await h.rpc.impactSubgraph(h.ctx(), {
      rids: [s1],
      maxHops: 3,
      limit: 100,
    });
    expect(degraded.degraded).toBe(true);
    expect(degraded.nodes).toHaveLength(5);
  });
});
