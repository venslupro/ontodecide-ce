/**
 * @fileoverview Integration tests of object-graph against the real
 * migrations (node:sqlite D1): upsert merge / hash skip / limits /
 * REF_MISSING, outbox delivery and redelivery, reads and queries, PATCH with
 * If-Match, actions (idempotency, preconditions, effects, actors), graph
 * traversal, tenant isolation and the TenantLifecycle entry point.
 */

import {join} from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import type {
  ObjectGraphRpc,
  UpsertCmd,
} from '@ontodecide/object-graph/contract';
import type {CompiledSchema, OntologyRpc} from '@ontodecide/ontology/contract';
import {
  AppError,
  FixedClock,
  HOUR_MS,
  MINUTE_MS,
  serviceCtx,
  silentLogger,
} from '@ontodecide/shared-kernel';
import type {CallCtx, DomainEventMsg, Rid} from '@ontodecide/shared-kernel';
import {
  QueueBus,
  REPO_ROOT,
  SqliteD1,
  TEST_TID,
  rpcBinding,
  testCtx,
} from '@ontodecide/testing';
import {createTenantLifecycle} from '@ontodecide/object-graph/application';
import {D1LifecycleStore} from '@ontodecide/object-graph/infrastructure';
import {createService} from './service';
import {testSchema} from './test_fixtures';

const OTHER_TID = '01K6A000000000000000000T02';
const Q = 'domain-events';

interface Harness {
  db: SqliteD1;
  bus: QueueBus;
  clock: FixedClock;
  rpc: ObjectGraphRpc;
  svc: ReturnType<typeof createService>;
  setSchema(s: CompiledSchema): void;
  failQueue(fail: boolean): void;
  messages(): DomainEventMsg[];
}

function setup(
  opts: {maxObjects?: number; maxLinks?: number; maxEventBytes?: number} = {},
): Harness {
  const db = new SqliteD1().migrate(
    join(REPO_ROOT, 'migrations', 'object-graph'),
  );
  const bus = new QueueBus();
  const clock = new FixedClock('2026-09-24T00:00:00Z');
  let schema = testSchema();
  let failing = false;
  const sender = bus.sender<DomainEventMsg>(Q);
  const queue = {
    send: async (m: DomainEventMsg) => {
      if (failing) throw new Error('queue unavailable');
      await sender.send(m);
    },
  };
  const ontology = rpcBinding({getCompiledSchema: async () => schema});
  const svc = createService(
    {
      OBJECT_DB: db.asD1(),
      ONTOLOGY: ontology as unknown as OntologyRpc,
      DOMAIN_EVENTS: sender,
      MAX_OBJECTS: opts.maxObjects ? String(opts.maxObjects) : undefined,
      MAX_LINKS: opts.maxLinks ? String(opts.maxLinks) : undefined,
    },
    {clock, logger: silentLogger, queue, maxEventBytes: opts.maxEventBytes},
  );
  return {
    db,
    bus,
    clock,
    svc,
    rpc: rpcBinding(svc.rpc),
    setSchema: s => (schema = s),
    failQueue: f => (failing = f),
    messages: () => bus.peek(Q) as DomainEventMsg[],
  };
}

async function codeOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return AppError.from(e);
  }
  throw new Error('expected a rejection');
}

function supplier(
  pk: string,
  props: Record<string, unknown> = {},
  row = 1,
  links: UpsertCmd['links'] = [],
): UpsertCmd {
  return {
    type: 'Supplier',
    primaryKey: pk,
    props: {name: `Supplier ${pk}`, active: true, riskScore: 0.2, ...props},
    row,
    links,
  };
}

function part(
  pk: string,
  props: Record<string, unknown> = {},
  row = 1,
  links: UpsertCmd['links'] = [],
): UpsertCmd {
  return {
    type: 'Part',
    primaryKey: pk,
    props: {name: pk, ...props},
    row,
    links,
  };
}

function supplies(toKey: string, weight?: number) {
  return {type: 'supplies', toType: 'Part', toKey, weight};
}

async function ridOf(
  h: Harness,
  type: string,
  pk: string,
  ctx: CallCtx = testCtx(),
): Promise<Rid> {
  const page = await h.rpc.listObjects(ctx, {type, q: pk}, {limit: 100});
  const o = page.items.find(i => i.primaryKey === pk);
  if (!o) throw new Error(`no ${type} ${pk}`);
  return o.rid;
}

function count(h: Harness, sql: string, ...args: unknown[]): number {
  const r = h.db.raw.prepare(sql).get(...(args as string[])) as {n: number};
  return Number(r.n);
}

describe('upsertBatch', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  it('writes objects, index rows, links and provenance in one batch', async () => {
    const res = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'job-1',
      seq: 1,
      cmds: [
        supplier('S1', {country: 'CN', tier: 1}, 1, [supplies('P1', 0.7)]),
        part('P1', {stock: 10}, 2),
      ],
    });
    expect(res).toEqual({
      upserted: 2,
      skipped: 0,
      linksWritten: 1,
      rejected: [],
    });
    const s1 = await ridOf(h, 'Supplier', 'S1');
    const dto = (await h.rpc.getObject(testCtx(), s1))!;
    expect(dto.title).toBe('Supplier S1');
    expect(dto.version).toBe(1);
    expect(dto.props).toMatchObject({supplierId: 'S1', country: 'CN', tier: 1});
    expect(dto.provenance.country).toEqual({
      jobId: 'job-1',
      row: 1,
      at: h.clock.now().getTime(),
    });
    // Indexed props only: country, riskScore, tier (+ status unset).
    expect(
      count(h, 'SELECT COUNT(*) AS n FROM og_prop_index WHERE rid = ?', s1),
    ).toBe(3);
    const links = await h.rpc.getLinks(testCtx(), s1, {depth: 1});
    expect(links.edges).toEqual([
      {type: 'supplies', src: s1, dst: expect.any(String), weight: 0.7},
    ]);
  });

  it('delivers one aggregated ObjectsUpserted message and deletes the outbox row', async () => {
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'job-1',
      seq: 1,
      cmds: [supplier('S1'), supplier('S2', {}, 2)],
    });
    const msgs = h.messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      tid: TEST_TID,
      kind: 'ObjectsUpserted',
      jobId: 'job-1',
    });
    expect(msgs[0].changes).toHaveLength(2);
    expect(msgs[0].changes[0].changed).toEqual(
      expect.arrayContaining(['name', 'active', 'riskScore', 'supplierId']),
    );
    expect(JSON.stringify(msgs[0])).not.toContain('Supplier S1');
    expect(count(h, 'SELECT COUNT(*) AS n FROM domain_event')).toBe(0);
  });

  it('merges latest-wins: non-empty values overwrite, empty ones are ignored', async () => {
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'job-1',
      seq: 1,
      cmds: [supplier('S1', {country: 'CN', tier: 2, notes: 'old'})],
    });
    h.clock.advance(1000);
    const res = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'job-2',
      seq: 1,
      cmds: [
        {
          type: 'Supplier',
          primaryKey: 'S1',
          props: {country: 'DE', tier: '', notes: null},
          row: 7,
        },
      ],
    });
    expect(res.upserted).toBe(1);
    const dto = (await h.rpc.getObject(
      testCtx(),
      await ridOf(h, 'Supplier', 'S1'),
    ))!;
    expect(dto.props).toMatchObject({country: 'DE', tier: 2, notes: 'old'});
    expect(dto.version).toBe(2);
    expect(dto.provenance.country).toMatchObject({jobId: 'job-2', row: 7});
    expect(dto.provenance.tier).toMatchObject({jobId: 'job-1', row: 1});
    const last = h.messages().at(-1)!;
    expect(last.changes).toEqual([
      {rid: dto.rid, type: 'Supplier', changed: ['country']},
    ]);
  });

  it('skips unchanged rows (props_hash) without writing or publishing', async () => {
    const cmds = [supplier('S1'), supplier('S2', {}, 2)];
    await h.rpc.upsertBatch(testCtx(), {jobId: 'j', seq: 1, cmds});
    const written = h.db.rowsWritten;
    const sent = h.messages().length;
    const res = await h.rpc.upsertBatch(testCtx(), {jobId: 'j', seq: 2, cmds});
    expect(res).toEqual({
      upserted: 0,
      skipped: 2,
      linksWritten: 0,
      rejected: [],
    });
    expect(h.db.rowsWritten).toBe(written);
    expect(h.messages()).toHaveLength(sent);
    const dto = await h.rpc.getObject(
      testCtx(),
      await ridOf(h, 'Supplier', 'S1'),
    );
    expect(dto!.version).toBe(1);
  });

  it('rejects unknown types and invalid rows', async () => {
    const res = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [
        {type: 'Ghost', primaryKey: 'G', props: {}, row: 1},
        supplier('S1', {tier: 'many'}, 2),
        {type: 'Supplier', primaryKey: 'S2', props: {active: true}, row: 3},
        supplier('S3', {status: 'NOPE'}, 4),
        supplier('S4', {}, 5),
      ],
    });
    expect(res.upserted).toBe(1);
    expect(res.rejected).toEqual([
      {row: 1, code: 'UNKNOWN_TYPE'},
      {row: 2, code: 'VALIDATION', detail: 'tier:TYPE'},
      {row: 3, code: 'VALIDATION', detail: 'name:REQUIRED'},
      {row: 4, code: 'VALIDATION', detail: 'status:ENUM'},
    ]);
  });

  it('rejects more than 100 commands', async () => {
    const cmds = Array.from({length: 101}, (_, i) => supplier(`S${i}`, {}, i));
    const err = await codeOf(
      h.rpc.upsertBatch(testCtx(), {jobId: 'j', seq: 1, cmds}),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
  });

  it('resolves links within the batch and rejects missing targets (REF_MISSING)', async () => {
    const res = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [
        supplier('S1', {}, 1, [supplies('P1'), supplies('P404')]),
        part('P1', {}, 2),
        supplier('S2', {}, 3, [
          {type: 'supplies', toType: 'Supplier', toKey: 'S1'},
        ]),
      ],
    });
    expect(res.upserted).toBe(3);
    expect(res.linksWritten).toBe(1);
    expect(res.rejected).toEqual([
      {row: 1, code: 'REF_MISSING', detail: 'supplies->Part'},
      {row: 3, code: 'VALIDATION', detail: 'link:supplies'},
    ]);
    // A later batch can reference objects written earlier.
    const res2 = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 2,
      cmds: [
        part('P2', {}, 1, [{type: 'dependsOn', toType: 'Part', toKey: 'P1'}]),
      ],
    });
    expect(res2.linksWritten).toBe(1);
    expect((await h.rpc.stats(testCtx())).links).toBe(2);
  });

  it('updates link weights and does not rewrite unchanged links', async () => {
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [part('P1'), supplier('S1', {}, 2, [supplies('P1', 0.3)])],
    });
    const same = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 2,
      cmds: [supplier('S1', {}, 1, [supplies('P1', 0.3)])],
    });
    expect(same).toMatchObject({skipped: 1, linksWritten: 0});
    const changed = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 3,
      cmds: [supplier('S1', {}, 1, [supplies('P1', 0.9)])],
    });
    expect(changed).toMatchObject({skipped: 1, linksWritten: 1});
    const last = h.messages().at(-1)!;
    expect(last.changes).toEqual([
      {rid: await ridOf(h, 'Supplier', 'S1'), type: 'Supplier', changed: []},
    ]);
  });

  it('keeps each call well under 50 D1 statements', async () => {
    const cmds: UpsertCmd[] = [];
    for (let i = 0; i < 50; i++) cmds.push(part(`P${i}`, {stock: i}, i));
    for (let i = 0; i < 50; i++) {
      cmds.push(
        supplier(`S${i}`, {tier: i}, 50 + i, [
          supplies(`P${i}`),
          supplies(`P${(i + 1) % 50}`),
        ]),
      );
    }
    const before = h.db.queries;
    const res = await h.rpc.upsertBatch(testCtx(), {jobId: 'j', seq: 1, cmds});
    expect(res).toMatchObject({upserted: 100, linksWritten: 100, rejected: []});
    const statements = h.db.queries - before;
    // 3 reads + objects, index delete, index insert, links, outbox + delete.
    expect(statements).toBeLessThanOrEqual(9);
    const again = h.db.queries;
    await h.rpc.upsertBatch(testCtx(), {jobId: 'j', seq: 2, cmds});
    expect(h.db.queries - again).toBeLessThanOrEqual(3);
  });
});

describe('workspace limits', () => {
  it('rejects objects beyond MAX_OBJECTS but still updates existing ones', async () => {
    const h = setup({maxObjects: 5});
    const cmds = Array.from({length: 7}, (_, i) =>
      supplier(`S${i}`, {}, i + 1),
    );
    const res = await h.rpc.upsertBatch(testCtx(), {jobId: 'j', seq: 1, cmds});
    expect(res.upserted).toBe(5);
    expect(res.rejected).toEqual([
      {row: 6, code: 'OBJECT_LIMIT'},
      {row: 7, code: 'OBJECT_LIMIT'},
    ]);
    const upd = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 2,
      cmds: [supplier('S0', {country: 'FR'}), supplier('S9', {}, 2)],
    });
    expect(upd.upserted).toBe(1);
    expect(upd.rejected).toEqual([{row: 2, code: 'OBJECT_LIMIT'}]);
  });

  it('rejects links beyond MAX_LINKS while the object is written', async () => {
    const h = setup({maxLinks: 3});
    const res = await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [
        part('P1'),
        part('P2', {}, 2),
        part('P3', {}, 3),
        part('P4', {}, 4),
        supplier('S1', {}, 5, [
          supplies('P1'),
          supplies('P2'),
          supplies('P3'),
          supplies('P4'),
        ]),
      ],
    });
    expect(res.upserted).toBe(5);
    expect(res.linksWritten).toBe(3);
    expect(res.rejected).toEqual([
      {row: 5, code: 'LINK_LIMIT', detail: 'supplies'},
    ]);
  });

  it('never exceeds the limits under concurrent batches', async () => {
    const h = setup({maxObjects: 5, maxLinks: 4});
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 0,
      cmds: [part('P1'), part('P2', {}, 2)],
    });
    const batch = (prefix: string) =>
      h.rpc.upsertBatch(testCtx(), {
        jobId: prefix,
        seq: 1,
        cmds: [1, 2].map(i =>
          supplier(`${prefix}${i}`, {}, i, [supplies('P1'), supplies('P2')]),
        ),
      });
    const results = await Promise.all([batch('A'), batch('B')]);
    const stats = await h.rpc.stats(testCtx());
    expect(stats.objects).toBe(5);
    expect(stats.links).toBe(4);
    const upserted = results.reduce((n, r) => n + r.upserted, 0);
    const objectRejects = results
      .flatMap(r => r.rejected)
      .filter(r => r.code === 'OBJECT_LIMIT').length;
    expect(upserted).toBe(3);
    expect(objectRejects).toBe(1);
    expect(results.reduce((n, r) => n + r.linksWritten, 0)).toBe(4);
  });
});

describe('outbox delivery', () => {
  it('leaves the outbox row when the queue fails and the cron redelivers it', async () => {
    const h = setup();
    h.failQueue(true);
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [supplier('S1')],
    });
    expect(h.messages()).toHaveLength(0);
    expect(count(h, 'SELECT COUNT(*) AS n FROM domain_event')).toBe(1);
    h.failQueue(false);
    // Too young: left to the request's own delivery.
    await h.svc.scheduled('*/15 * * * *', h.clock.now());
    expect(h.messages()).toHaveLength(0);
    h.clock.advance(2 * MINUTE_MS);
    await h.svc.scheduled('*/15 * * * *', h.clock.now());
    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0].kind).toBe('ObjectsUpserted');
    expect(count(h, 'SELECT COUNT(*) AS n FROM domain_event')).toBe(0);
  });

  it('stores only the changes the guarded batch wrote (never rejected rids)', async () => {
    // Two concurrent batches both plan with free capacity; the in-batch
    // guards then reject one object and some links of the later batch.
    const h = setup({maxObjects: 5, maxLinks: 4});
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 0,
      cmds: [part('P1'), part('P2', {}, 2)],
    });
    h.failQueue(true);
    const batch = (prefix: string) =>
      h.rpc.upsertBatch(testCtx(), {
        jobId: prefix,
        seq: 1,
        cmds: [1, 2].map(i =>
          supplier(`${prefix}${i}`, {}, i, [supplies('P1'), supplies('P2')]),
        ),
      });
    const results = await Promise.all([batch('A'), batch('B')]);
    expect(results.flatMap(r => r.rejected).length).toBeGreaterThan(0);

    const written = new Set(
      (
        h.db.raw.prepare('SELECT rid FROM og_object').all() as {rid: string}[]
      ).map(r => r.rid),
    );
    const linked = new Set(
      (
        h.db.raw.prepare('SELECT src_rid FROM og_link').all() as {
          src_rid: string;
        }[]
      ).map(r => r.src_rid),
    );
    const rows = h.db.raw.prepare('SELECT payload FROM domain_event').all() as {
      payload: string;
    }[];
    const stored = rows.flatMap(
      r => (JSON.parse(r.payload) as DomainEventMsg).changes,
    );
    // 3 suppliers were written (5 - 2 parts); the rejected one is absent.
    expect(stored).toHaveLength(3);
    for (const c of stored) {
      expect(written.has(c.rid) || linked.has(c.rid)).toBe(true);
    }

    h.failQueue(false);
    h.clock.advance(2 * MINUTE_MS);
    await h.svc.scheduled('*/15 * * * *', h.clock.now());
    const redelivered = h
      .messages()
      .filter(m => m.jobId !== 'j')
      .flatMap(m => m.changes.map(c => c.rid));
    expect(redelivered.sort()).toEqual(stored.map(c => c.rid).sort());
    expect(redelivered.every(r => written.has(r))).toBe(true);
  });

  it('stores no outbox row when the guards rejected everything', async () => {
    const h = setup({maxObjects: 1});
    h.failQueue(true);
    const batch = (pk: string) =>
      h.rpc.upsertBatch(testCtx(), {
        jobId: pk,
        seq: 1,
        cmds: [supplier(pk)],
      });
    const results = await Promise.all([batch('A'), batch('B')]);
    expect(results.reduce((n, r) => n + r.upserted, 0)).toBe(1);
    expect(count(h, 'SELECT COUNT(*) AS n FROM domain_event')).toBe(1);
  });

  it('splits messages larger than the bound by rid', async () => {
    const h = setup({maxEventBytes: 1024});
    const cmds = Array.from({length: 40}, (_, i) => supplier(`S${i}`, {}, i));
    await h.rpc.upsertBatch(testCtx(), {jobId: 'j', seq: 1, cmds});
    const msgs = h.messages();
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(JSON.stringify(m).length).toBeLessThanOrEqual(1024);
      expect(m.eventId).toMatch(/#\d+$/);
    }
    expect(msgs.flatMap(m => m.changes)).toHaveLength(40);
    expect(new Set(msgs.map(m => m.eventId)).size).toBe(msgs.length);
  });

  it('drops outbox rows of purged workspaces and sweeps old tombstones', async () => {
    const h = setup();
    h.failQueue(true);
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [supplier('S1')],
    });
    h.failQueue(false);
    h.db.raw
      .prepare(
        'INSERT INTO tenant_tombstone (tenant_id, deleted_at) VALUES (?, ?)',
      )
      .run(TEST_TID, h.clock.now().getTime());
    h.clock.advance(2 * MINUTE_MS);
    await h.svc.scheduled('*/15 * * * *', h.clock.now());
    expect(h.messages()).toHaveLength(0);
    expect(count(h, 'SELECT COUNT(*) AS n FROM domain_event')).toBe(0);
    expect(count(h, 'SELECT COUNT(*) AS n FROM tenant_tombstone')).toBe(1);
    h.clock.advance(49 * HOUR_MS);
    await h.svc.scheduled('*/15 * * * *', h.clock.now());
    expect(count(h, 'SELECT COUNT(*) AS n FROM tenant_tombstone')).toBe(0);
  });
});

describe('reads and queries', () => {
  let h: Harness;
  beforeEach(async () => {
    h = setup();
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [
        supplier('S1', {country: 'CN', riskScore: 0.9, tier: 1, notes: 'late'}),
        supplier(
          'S2',
          {country: 'DE', riskScore: 0.1, tier: 2, active: false},
          2,
        ),
        supplier(
          'S3',
          {country: 'CN', riskScore: 0.5, tier: 3, notes: 'ok'},
          3,
        ),
        supplier('S4', {country: 'US', riskScore: 0.7, tier: 1}, 4),
        supplier('S5', {riskScore: 0.3, tier: 2, name: 'Acme Metals'}, 5),
        part('P1', {stock: 5, critical: true}, 6),
      ],
    });
  });

  const pks = (items: {primaryKey: string}[]) => items.map(i => i.primaryKey);

  it('pushes indexed filters and sort keys down to D1', async () => {
    const page = await h.rpc.listObjects(
      testCtx(),
      {
        type: 'Supplier',
        filter: {op: 'eq', prop: 'country', value: 'CN'},
        orderBy: {prop: 'riskScore', dir: 'desc'},
      },
      {},
    );
    expect(pks(page.items)).toEqual(['S1', 'S3']);
    const gt = await h.rpc.listObjects(
      testCtx(),
      {
        type: 'Supplier',
        filter: {
          op: 'and',
          args: [
            {op: 'gte', prop: 'riskScore', value: 0.3},
            {op: 'in', prop: 'tier', values: [1, 2]},
          ],
        },
        orderBy: {prop: 'riskScore', dir: 'asc'},
      },
      {},
    );
    expect(pks(gt.items)).toEqual(['S5', 'S4', 'S1']);
    const neq = await h.rpc.listObjects(
      testCtx(),
      {type: 'Supplier', filter: {op: 'neq', prop: 'country', value: 'CN'}},
      {},
    );
    expect(pks(neq.items).sort()).toEqual(['S2', 'S4', 'S5']);
  });

  it('evaluates non-indexed filters in memory', async () => {
    const page = await h.rpc.listObjects(
      testCtx(),
      {
        type: 'Supplier',
        filter: {
          op: 'and',
          args: [
            {op: 'eq', prop: 'country', value: 'CN'},
            {op: 'contains', prop: 'notes', value: 'LAT'},
          ],
        },
      },
      {},
    );
    expect(pks(page.items)).toEqual(['S1']);
    const inactive = await h.rpc.listObjects(
      testCtx(),
      {type: 'Supplier', filter: {op: 'eq', prop: 'active', value: false}},
      {},
    );
    expect(pks(inactive.items)).toEqual(['S2']);
  });

  it('searches title, primary key and RID', async () => {
    const byTitle = await h.rpc.listObjects(testCtx(), {q: 'acme'}, {});
    expect(pks(byTitle.items)).toEqual(['S5']);
    const rid = await ridOf(h, 'Part', 'P1');
    const byRid = await h.rpc.listObjects(testCtx(), {q: rid}, {});
    expect(pks(byRid.items)).toEqual(['P1']);
  });

  it('pages with a cursor (limit ≤ 100)', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await h.rpc.listObjects(
        testCtx(),
        {type: 'Supplier', orderBy: {prop: 'tier', dir: 'asc'}},
        {cursor, limit: 2},
      );
      seen.push(...pks(page.items));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const inMem: string[] = [];
    cursor = undefined;
    for (let i = 0; i < 5; i++) {
      const page = await h.rpc.listObjects(
        testCtx(),
        {type: 'Supplier', filter: {op: 'exists', prop: 'notes'}},
        {cursor, limit: 1},
      );
      inMem.push(...pks(page.items));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(inMem.sort()).toEqual(['S1', 'S3']);
  });

  it('rejects sorting on non-indexed properties', async () => {
    const err = await codeOf(
      h.rpc.listObjects(
        testCtx(),
        {type: 'Supplier', orderBy: {prop: 'notes', dir: 'asc'}},
        {},
      ),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
  });

  it('drops props absent from the ontology and reports invalid ones', async () => {
    h.setSchema(
      testSchema(s => {
        const t = s.objectTypes.Supplier;
        t.properties = t.properties.filter(p => p.apiName !== 'notes');
        delete t.propsByName.notes;
        t.propsByName.tier.dataType = 'string';
      }),
    );
    const dto = (await h.rpc.getObject(
      testCtx(),
      await ridOf(h, 'Supplier', 'S1'),
    ))!;
    expect(dto.props.notes).toBeUndefined();
    expect(dto.provenance.notes).toBeUndefined();
    expect(dto.invalidProps).toEqual(['tier']);
  });

  it('reads several objects by rid and counts the workspace', async () => {
    const r1 = await ridOf(h, 'Supplier', 'S1');
    const r2 = await ridOf(h, 'Part', 'P1');
    const many = await h.rpc.getObjects(testCtx(), [
      r2,
      r1,
      'ri.Part.01K6A0000000000000000000ZZ' as Rid,
    ]);
    expect(pks(many)).toEqual(['P1', 'S1']);
    expect(await h.rpc.stats(testCtx())).toEqual({
      objects: 6,
      links: 0,
      byType: {Supplier: 5, Part: 1},
    });
  });

  it('evaluates the declarative functions of the object type into derived', async () => {
    // The supply-chain template's two functions (scaled to this fixture).
    h.setSchema(
      testSchema(s => {
        s.functions = {
          supplierRiskLevel: {
            apiName: 'supplierRiskLevel',
            objectType: 'Supplier',
            expr: {
              if: [
                {'>=': [{var: 'riskScore'}, 0.7]},
                'HIGH',
                {'>=': [{var: 'riskScore'}, 0.4]},
                'MEDIUM',
                'LOW',
              ],
            },
            returns: 'string',
          },
          stockCoverage: {
            apiName: 'stockCoverage',
            objectType: 'Part',
            expr: {'/': [{var: 'stock'}, {var: 'safetyStock'}]},
            returns: 'double',
          },
        };
      }),
    );
    const r1 = await ridOf(h, 'Supplier', 'S1');
    const one = await h.rpc.getObject(testCtx(), r1);
    expect(one?.derived).toEqual({supplierRiskLevel: 'HIGH'});
    const r2 = await ridOf(h, 'Part', 'P1');
    const [part1] = await h.rpc.getObjects(testCtx(), [r2]);
    // safetyStock is not a Part property: division by missing → null.
    expect(part1.derived).toEqual({stockCoverage: null});
    const page = await h.rpc.listObjects(
      testCtx(),
      {type: 'Supplier'},
      {limit: 100},
    );
    expect(page.items.every(o => o.derived?.supplierRiskLevel)).toBe(true);
  });
});

describe('patchObject', () => {
  let h: Harness;
  let rid: Rid;
  beforeEach(async () => {
    h = setup();
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [supplier('S1', {riskScore: 0.2, notes: 'n'})],
    });
    rid = await ridOf(h, 'Supplier', 'S1');
  });

  it('applies a merge patch with If-Match and publishes ObjectPatched', async () => {
    const dto = await h.rpc.patchObject(
      testCtx(),
      rid,
      {riskScore: '0.95', notes: null},
      1,
    );
    expect(dto.version).toBe(2);
    expect(dto.props.riskScore).toBe(0.95);
    expect(dto.props.notes).toBeUndefined();
    expect(dto.provenance.riskScore).toBeUndefined();
    const msg = h.messages().at(-1)!;
    expect(msg.kind).toBe('ObjectPatched');
    expect(msg.changes).toEqual([
      {rid, type: 'Supplier', changed: ['riskScore', 'notes']},
    ]);
    const found = await h.rpc.listObjects(
      testCtx(),
      {type: 'Supplier', filter: {op: 'gt', prop: 'riskScore', value: 0.9}},
      {},
    );
    expect(found.items.map(i => i.rid)).toEqual([rid]);
  });

  it('returns 412 for a stale If-Match (two tabs)', async () => {
    const [a, b] = await Promise.allSettled([
      h.rpc.patchObject(testCtx(), rid, {notes: 'tab A'}, 1),
      h.rpc.patchObject(testCtx(), rid, {notes: 'tab B'}, 1),
    ]);
    const outcomes = [a, b].map(r => r.status);
    expect(outcomes.sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = [a, b].find(
      r => r.status === 'rejected',
    ) as PromiseRejectedResult;
    const err = AppError.from(rejected.reason);
    expect(err.code).toBe('PRECONDITION_FAILED');
    expect(err.status).toBe(412);
    const stale = await codeOf(
      h.rpc.patchObject(testCtx(), rid, {notes: 'late'}, 1),
    );
    expect(stale.code).toBe('PRECONDITION_FAILED');
    expect((await h.rpc.getObject(testCtx(), rid))!.version).toBe(2);
    expect(count(h, 'SELECT COUNT(*) AS n FROM domain_event')).toBe(0);
  });

  it('validates the patch', async () => {
    expect(
      (await codeOf(h.rpc.patchObject(testCtx(), rid, {bogus: 1}, 1))).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await codeOf(h.rpc.patchObject(testCtx(), rid, {tier: 'x'}, 1))).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await codeOf(h.rpc.patchObject(testCtx(), rid, {name: null}, 1))).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      (await codeOf(h.rpc.patchObject(testCtx(), rid, {supplierId: 'S9'}, 1)))
        .code,
    ).toBe('VALIDATION_FAILED');
    const missing = 'ri.Supplier.01K6A0000000000000000000ZZ' as Rid;
    expect(
      (await codeOf(h.rpc.patchObject(testCtx(), missing, {}, 1))).code,
    ).toBe('NOT_FOUND');
  });
});

describe('graph traversal', () => {
  let h: Harness;
  beforeEach(async () => {
    h = setup();
    // S1 → P1 → P2 → P3 (dependsOn), S2 → P1.
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [
        part('P3', {}, 1),
        part('P2', {}, 2, [{type: 'dependsOn', toType: 'Part', toKey: 'P3'}]),
        part('P1', {}, 3, [{type: 'dependsOn', toType: 'Part', toKey: 'P2'}]),
        supplier('S1', {}, 4, [supplies('P1', 0.6)]),
        supplier('S2', {}, 5, [supplies('P1')]),
      ],
    });
  });

  it('walks links around an object up to depth 2', async () => {
    const s1 = await ridOf(h, 'Supplier', 'S1');
    const d1 = await h.rpc.getLinks(testCtx(), s1, {depth: 1});
    expect(d1.nodes.map(n => [n.title, n.hop])).toEqual([
      ['Supplier S1', 0],
      ['P1', 1],
    ]);
    const d2 = await h.rpc.getLinks(testCtx(), s1, {depth: 2});
    expect(d2.nodes.map(n => n.title).sort()).toEqual(
      ['P1', 'P2', 'Supplier S1', 'Supplier S2'].sort(),
    );
    expect(d2.nodes.find(n => n.title === 'P3')).toBeUndefined();
    const out = await h.rpc.getLinks(testCtx(), s1, {
      depth: 2,
      direction: 'out',
    });
    expect(out.nodes.map(n => n.title).sort()).toEqual(
      ['P1', 'P2', 'Supplier S1'].sort(),
    );
    const typed = await h.rpc.getLinks(testCtx(), s1, {
      depth: 2,
      linkTypes: ['supplies'],
    });
    expect(typed.nodes.map(n => n.title).sort()).toEqual(
      ['P1', 'Supplier S1', 'Supplier S2'].sort(),
    );
    expect(typed.edges.every(e => e.type === 'supplies')).toBe(true);
    const cut = await h.rpc.getLinks(testCtx(), s1, {depth: 2, limit: 2});
    expect(cut.nodes).toHaveLength(2);
    expect(cut.truncated).toBe(true);
    expect(d2.truncated).toBe(false);
  });

  it('computes the outgoing impact subgraph (6.3.2)', async () => {
    const s1 = await ridOf(h, 'Supplier', 'S1');
    const one = await h.rpc.impactSubgraph(testCtx(), {
      rids: [s1],
      linkTypes: ['supplies', 'dependsOn'],
      depth: 1,
      limit: 300,
    });
    expect(one.nodes.map(n => n.title)).toEqual(['Supplier S1', 'P1']);
    const two = await h.rpc.impactSubgraph(testCtx(), {
      rids: [s1],
      linkTypes: ['supplies', 'dependsOn'],
      depth: 2,
      limit: 300,
    });
    expect(two.nodes.map(n => [n.title, n.hop])).toEqual([
      ['Supplier S1', 0],
      ['P1', 1],
      ['P2', 2],
    ]);
    expect(two.edges.map(e => e.type).sort()).toEqual([
      'dependsOn',
      'supplies',
    ]);
    expect(two.edges.find(e => e.type === 'supplies')!.weight).toBe(0.6);
    const onlySupplies = await h.rpc.impactSubgraph(testCtx(), {
      rids: [s1],
      linkTypes: ['supplies'],
      depth: 2,
      limit: 300,
    });
    expect(onlySupplies.nodes).toHaveLength(2);
    const cut = await h.rpc.impactSubgraph(testCtx(), {
      rids: [s1],
      linkTypes: ['supplies', 'dependsOn'],
      depth: 2,
      limit: 1,
    });
    expect(cut).toMatchObject({truncated: true});
    expect(cut.nodes).toHaveLength(1);
  });

  it('rejects depth > 2 and unknown roots', async () => {
    const s1 = await ridOf(h, 'Supplier', 'S1');
    const err = await codeOf(h.rpc.getLinks(testCtx(), s1, {depth: 3 as 2}));
    expect(err.code).toBe('VALIDATION_FAILED');
    const missing = 'ri.Part.01K6A0000000000000000000ZZ' as Rid;
    expect(
      (await codeOf(h.rpc.getLinks(testCtx(), missing, {depth: 1}))).code,
    ).toBe('NOT_FOUND');
  });
});

describe('applyAction', () => {
  let h: Harness;
  let s1: Rid;
  let s2: Rid;
  let p1: Rid;
  beforeEach(async () => {
    h = setup();
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [
        part('P1'),
        supplier('S1', {riskScore: 0.5}, 2, [supplies('P1')]),
        supplier('S2', {}, 3),
        supplier('S3', {active: false}, 4),
      ],
    });
    s1 = await ridOf(h, 'Supplier', 'S1');
    s2 = await ridOf(h, 'Supplier', 'S2');
    p1 = await ridOf(h, 'Part', 'P1');
  });

  const flag = (key: string, ifMatch?: number, target?: Rid) => ({
    actionType: 'flagSupplier',
    target: target ?? s1,
    params: {reason: 'late shipments'},
    ifMatch,
    idempotencyKey: key,
  });

  it('executes effects, logs the owner and publishes ActionExecuted', async () => {
    const res = await h.rpc.applyAction(
      testCtx(),
      flag('key-0000000000000001', 1),
    );
    expect(res).toMatchObject({
      actionType: 'flagSupplier',
      rid: s1,
      version: 2,
      replayed: false,
      before: {riskScore: 0.5},
      after: {riskScore: 0.6, status: 'REVIEW', notes: 'late shipments'},
    });
    const dto = (await h.rpc.getObject(testCtx(), s1))!;
    expect(dto.version).toBe(2);
    expect(dto.props.status).toBe('REVIEW');
    const msg = h.messages().at(-1)!;
    expect(msg).toMatchObject({
      kind: 'ActionExecuted',
      actionLogId: res.actionLogId,
    });
    const log = await h.rpc.listActionLog(testCtx(), s1, {});
    expect(log.items).toHaveLength(1);
    expect(log.items[0]).toMatchObject({
      actor: 'owner',
      actionType: 'flagSupplier',
    });
    expect(log.items[0].actorUserId).toBeUndefined();
    const indexed = await h.rpc.listObjects(
      testCtx(),
      {type: 'Supplier', filter: {op: 'eq', prop: 'status', value: 'REVIEW'}},
      {},
    );
    expect(indexed.items.map(i => i.rid)).toEqual([s1]);
  });

  it('replays an idempotency key with the first result', async () => {
    const first = await h.rpc.applyAction(
      testCtx(),
      flag('key-0000000000000002', 1),
    );
    const sent = h.messages().length;
    const again = await h.rpc.applyAction(
      testCtx(),
      flag('key-0000000000000002', 1),
    );
    expect(again).toEqual({...first, replayed: true});
    expect(h.messages()).toHaveLength(sent);
    expect((await h.rpc.getObject(testCtx(), s1))!.version).toBe(2);
    const reuse = await codeOf(
      h.rpc.applyAction(testCtx(), flag('key-0000000000000002', 1, s2)),
    );
    expect(reuse.code).toBe('CONFLICT');
  });

  it('returns the same result for concurrent requests with one key', async () => {
    const results = await Promise.allSettled([
      h.rpc.applyAction(testCtx(), flag('key-0000000000000003', 1)),
      h.rpc.applyAction(testCtx(), flag('key-0000000000000003', 1)),
    ]);
    const ok = results.filter(
      r => r.status === 'fulfilled',
    ) as PromiseFulfilledResult<{actionLogId: string}>[];
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map(r => r.value.actionLogId)).size).toBe(1);
    expect(count(h, 'SELECT COUNT(*) AS n FROM og_action_log')).toBe(1);
    expect((await h.rpc.getObject(testCtx(), s1))!.version).toBe(2);
  });

  it('requires If-Match from humans and rejects stale versions', async () => {
    const missing = await codeOf(
      h.rpc.applyAction(testCtx(), flag('key-0000000000000004')),
    );
    expect(missing.code).toBe('PRECONDITION_FAILED');
    const stale = await codeOf(
      h.rpc.applyAction(testCtx(), flag('key-0000000000000005', 7)),
    );
    expect(stale.status).toBe(412);
    expect(count(h, 'SELECT COUNT(*) AS n FROM og_action_log')).toBe(0);
  });

  it('lets decision-engine execute without If-Match as svc:decision-engine', async () => {
    const ctx = serviceCtx(TEST_TID, 'decision-engine');
    const res = await h.rpc.applyAction(ctx, {
      ...flag('rec:01K6A0000000000000000REC1'),
      recommendationId: '01K6A0000000000000000REC1',
    });
    expect(res.version).toBe(2);
    const log = await h.rpc.listActionLog(testCtx(), s1, {});
    expect(log.items[0]).toMatchObject({
      actor: 'svc:decision-engine',
      recommendationId: '01K6A0000000000000000REC1',
    });
    expect(h.messages().at(-1)!.recommendationId).toBe(
      '01K6A0000000000000000REC1',
    );
    const other = await codeOf(
      h.rpc.applyAction(
        serviceCtx(TEST_TID, 'data-integration'),
        flag('key-0000000000000006'),
      ),
    );
    expect(other.code).toBe('FORBIDDEN');
  });

  it('records admin actions under Act-as with the admin user id', async () => {
    const ctx = testCtx({
      role: 'admin',
      actingAs: true,
      sub: '01K6A000000000000000000A01',
    });
    ctx.actor.userId = '01K6A000000000000000000A01';
    await h.rpc.applyAction(ctx, flag('key-0000000000000007', 1));
    const log = await h.rpc.listActionLog(testCtx(), s1, {});
    expect(log.items[0]).toMatchObject({
      actor: 'admin',
      actorUserId: '01K6A000000000000000000A01',
    });
  });

  it('rejects unmet preconditions with 422 and localized messages', async () => {
    const s3 = await ridOf(h, 'Supplier', 'S3');
    const err = await codeOf(
      h.rpc.applyAction(
        testCtx({locale: 'en-US'}),
        flag('key-0000000000000008', 1, s3),
      ),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.status).toBe(422);
    expect(err.extras.unmet).toEqual(['Supplier is inactive']);
    const params = await codeOf(
      h.rpc.applyAction(testCtx(), {
        ...flag('key-0000000000000009', 1),
        params: {},
      }),
    );
    expect(params).toMatchObject({code: 'VALIDATION_FAILED', status: 400});
  });

  it('relinks and unlinks within the workspace', async () => {
    const res = await h.rpc.applyAction(testCtx(), {
      actionType: 'switchSupplier',
      target: p1,
      params: {newSupplier: s2},
      ifMatch: 1,
      idempotencyKey: 'key-0000000000000010',
    });
    expect(res.version).toBe(2);
    const links = await h.rpc.getLinks(testCtx(), p1, {
      depth: 1,
      direction: 'in',
    });
    expect(links.edges.map(e => e.src)).toEqual([s2]);
    const changes = h
      .messages()
      .at(-1)!
      .changes.map(c => c.rid)
      .sort();
    expect(changes).toEqual([p1, s1, s2].sort());
    await h.rpc.applyAction(testCtx(), {
      actionType: 'dropSupplier',
      target: p1,
      params: {supplier: s2},
      ifMatch: 2,
      idempotencyKey: 'key-0000000000000011',
    });
    expect((await h.rpc.stats(testCtx())).links).toBe(0);
    const bad = await codeOf(
      h.rpc.applyAction(testCtx(), {
        actionType: 'switchSupplier',
        target: p1,
        params: {newSupplier: 'ri.Supplier.01K6A0000000000000000000ZZ'},
        ifMatch: 3,
        idempotencyKey: 'key-0000000000000012',
      }),
    );
    expect(bad.code).toBe('VALIDATION_FAILED');
  });

  it('pages the action log newest first', async () => {
    for (let i = 0; i < 3; i++) {
      h.clock.advance(1000);
      await h.rpc.applyAction(testCtx(), flag(`key-00000000000001${i}`, i + 1));
    }
    const first = await h.rpc.listActionLog(testCtx(), s1, {limit: 2});
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await h.rpc.listActionLog(testCtx(), s1, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map(i => i.executedAt);
    expect([...all].sort().reverse()).toEqual(all);
  });
});

describe('tenant isolation', () => {
  it('never reads or writes across workspaces', async () => {
    const h = setup();
    const a = testCtx();
    const b = testCtx({tid: OTHER_TID, sub: '01K6A000000000000000000U02'});
    await h.rpc.upsertBatch(a, {
      jobId: 'j',
      seq: 1,
      cmds: [part('P1'), supplier('S1', {}, 2, [supplies('P1')])],
    });
    await h.rpc.upsertBatch(b, {
      jobId: 'j',
      seq: 1,
      cmds: [supplier('S1', {name: 'B corp'})],
    });
    const ra = await ridOf(h, 'Supplier', 'S1', a);
    const rb = await ridOf(h, 'Supplier', 'S1', b);
    expect(ra).not.toBe(rb);
    expect(await h.rpc.getObject(b, ra)).toBeNull();
    expect(await h.rpc.getObjects(b, [ra])).toEqual([]);
    expect((await h.rpc.listObjects(b, {}, {})).items.map(i => i.rid)).toEqual([
      rb,
    ]);
    expect((await codeOf(h.rpc.patchObject(b, ra, {notes: 'x'}, 1))).code).toBe(
      'NOT_FOUND',
    );
    expect((await codeOf(h.rpc.getLinks(b, ra, {depth: 1}))).code).toBe(
      'NOT_FOUND',
    );
    const impact = await h.rpc.impactSubgraph(b, {
      rids: [ra],
      linkTypes: ['supplies'],
      depth: 2,
      limit: 10,
    });
    expect(impact.nodes).toEqual([]);
    expect(
      (
        await codeOf(
          h.rpc.applyAction(b, {
            actionType: 'flagSupplier',
            target: ra,
            params: {reason: 'x'},
            ifMatch: 1,
            idempotencyKey: 'key-0000000000000099',
          }),
        )
      ).code,
    ).toBe('NOT_FOUND');
    expect(await h.rpc.stats(b)).toEqual({
      objects: 1,
      links: 0,
      byType: {Supplier: 1},
    });
    // Same primary key in two workspaces are two objects.
    expect((await h.rpc.getObject(a, ra))!.title).toBe('Supplier S1');
    expect((await h.rpc.getObject(b, rb))!.title).toBe('B corp');
  });
});

describe('TenantLifecycle', () => {
  async function seeded() {
    const h = setup();
    await h.rpc.upsertBatch(testCtx(), {
      jobId: 'j',
      seq: 1,
      cmds: [
        part('P1', {stock: 1}),
        part('P2', {stock: 2}, 2),
        supplier('S1', {}, 3, [supplies('P1'), supplies('P2')]),
      ],
    });
    const s1 = await ridOf(h, 'Supplier', 'S1');
    await h.rpc.applyAction(testCtx(), {
      actionType: 'flagSupplier',
      target: s1,
      params: {reason: 'r'},
      ifMatch: 1,
      idempotencyKey: 'key-0000000000000001',
    });
    await h.rpc.upsertBatch(testCtx({tid: OTHER_TID}), {
      jobId: 'j',
      seq: 1,
      cmds: [supplier('X1')],
    });
    return h;
  }

  it('counts objects and links of several workspaces in one call', async () => {
    const h = await seeded();
    const lc = rpcBinding(h.svc.lifecycle);
    const missing = '01K6A000000000000000000T99';
    const before = h.db.queries;
    const stats = await lc.tenantStats!([TEST_TID, OTHER_TID, missing]);
    expect(h.db.queries - before).toBe(2);
    expect(stats).toEqual({
      [TEST_TID]: {objects: 3, links: 2},
      [OTHER_TID]: {objects: 1, links: 0},
      [missing]: {objects: 0, links: 0},
    });
    expect(await lc.tenantStats!([])).toEqual({});
    const tooMany = Array.from({length: 101}, (_, i) => `t${i}`);
    expect((await codeOf(lc.tenantStats!(tooMany))).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('exports objects, links and audit as JSON Lines pages', async () => {
    const h = await seeded();
    const lc = rpcBinding(h.svc.lifecycle);
    const pages = [];
    let cursor: string | null = null;
    do {
      const p = await lc.exportTenant(TEST_TID, cursor);
      pages.push(p);
      cursor = p.nextCursor;
    } while (cursor);
    expect(pages.map(p => p.file)).toEqual([
      'objects.jsonl',
      'links.jsonl',
      'audit.jsonl',
    ]);
    const objects = pages[0].text
      .trim()
      .split('\n')
      .map(l => JSON.parse(l));
    expect(objects).toHaveLength(3);
    expect(objects[0]).toHaveProperty('provenance');
    expect(pages[1].text.trim().split('\n')).toHaveLength(2);
    const audit = JSON.parse(pages[2].text.trim());
    expect(audit).toMatchObject({actionType: 'flagSupplier', actor: 'owner'});
    expect(audit).not.toHaveProperty('idempotencyKey');
  });

  it('pages by rows and bytes with a resumable cursor', async () => {
    const h = await seeded();
    const lc = createTenantLifecycle({
      store: new D1LifecycleStore(h.db.asD1()),
      clock: h.clock,
      pageRows: 2,
    });
    const files: string[] = [];
    let lines = 0;
    let cursor: string | null = null;
    do {
      const p = await lc.exportTenant(TEST_TID, cursor);
      files.push(p.file);
      lines += p.text ? p.text.trim().split('\n').length : 0;
      cursor = p.nextCursor;
    } while (cursor);
    expect(lines).toBe(3 + 2 + 1);
    expect(files.filter(f => f === 'objects.jsonl').length).toBe(2);
    const tiny = createTenantLifecycle({
      store: new D1LifecycleStore(h.db.asD1()),
      clock: h.clock,
      pageBytes: 10,
    });
    const first = await tiny.exportTenant(TEST_TID, null);
    expect(first.text.trim().split('\n')).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    await expect(tiny.exportTenant(TEST_TID, 'garbage')).rejects.toThrow();
  });

  it('purges in bounded steps, writes the tombstone and rejects late writes', async () => {
    const h = await seeded();
    const lc = rpcBinding(h.svc.lifecycle);
    const total = await lc.countTenant(TEST_TID);
    // 3 objects, 2 links, index rows, 1 action log.
    expect(total).toBeGreaterThan(6);
    let deleted = 0;
    let steps = 0;
    for (;;) {
      const r = await lc.purgeTenant(TEST_TID, 3);
      expect(r.deleted).toBeLessThanOrEqual(3);
      deleted += r.deleted;
      steps++;
      if (r.done) break;
    }
    expect(deleted).toBe(total);
    expect(steps).toBeGreaterThan(2);
    expect(await lc.countTenant(TEST_TID)).toBe(0);
    expect(
      count(
        h,
        'SELECT COUNT(*) AS n FROM tenant_tombstone WHERE tenant_id = ?',
        TEST_TID,
      ),
    ).toBe(1);
    expect(await lc.countTenant(OTHER_TID)).toBeGreaterThan(0);
    const late = await codeOf(
      h.rpc.upsertBatch(testCtx(), {
        jobId: 'j',
        seq: 9,
        cmds: [supplier('S9')],
      }),
    );
    expect(late.code).toBe('NOT_FOUND');
    expect(await lc.countTenant(TEST_TID)).toBe(0);
    const again = await lc.purgeTenant(TEST_TID, 500);
    expect(again).toEqual({deleted: 0, done: true});
  });

  it('deletes child rows before objects (purge order)', async () => {
    const h = await seeded();
    const lc = h.svc.lifecycle;
    const idx = count(
      h,
      'SELECT COUNT(*) AS n FROM og_prop_index WHERE tenant_id = ?',
      TEST_TID,
    );
    await lc.purgeTenant(TEST_TID, idx);
    expect(
      count(
        h,
        'SELECT COUNT(*) AS n FROM og_prop_index WHERE tenant_id = ?',
        TEST_TID,
      ),
    ).toBe(0);
    expect(
      count(
        h,
        'SELECT COUNT(*) AS n FROM og_object WHERE tenant_id = ?',
        TEST_TID,
      ),
    ).toBe(3);
    await lc.purgeTenant(TEST_TID, 2);
    expect(
      count(
        h,
        'SELECT COUNT(*) AS n FROM og_link WHERE tenant_id = ?',
        TEST_TID,
      ),
    ).toBe(0);
    expect(
      count(
        h,
        'SELECT COUNT(*) AS n FROM og_object WHERE tenant_id = ?',
        TEST_TID,
      ),
    ).toBe(3);
  });
});
