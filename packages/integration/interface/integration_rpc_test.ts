/**
 * @fileoverview Integration tests of the data-integration service over the
 * D1 emulation, in-memory queues and a stub OntologyRpc.
 */

import {
  AppError,
  FixedClock,
  silentLogger,
  ulid,
} from '@ontodecide/shared-kernel';
import type {CallCtx, QueueBatch} from '@ontodecide/shared-kernel';
import type {CompiledModel, OntologyRpc} from '@ontodecide/ontology/contract';
import {
  createTestD1,
  FetchMock,
  QueueBus,
  rpcBinding,
  testCtx,
} from '@ontodecide/testing';
import {beforeEach, describe, expect, it} from 'vitest';
import type {AppDeps} from '../application';
import type {
  IngestMsg,
  IntegrationRpc,
  ObjectWriteMsg,
  SourceDef,
  WriteResult,
} from '../contract';
import {signWebhook} from '../domain';
import {
  readSampleCsv,
  SUPPLIER_MAPPING,
  supplyChainModel,
} from '../domain/supply_chain_fixture';
import {
  AesSecretCipher,
  B2Presigner,
  CachedModelProvider,
  D1JobRepository,
  D1MaintenanceRepository,
  D1NonceRepository,
  D1RawRecordRepository,
  D1SourceRepository,
  DisabledPresigner,
  HttpRestFetcher,
  QueueIngestPublisher,
  QueueObjectWritePublisher,
} from '../infrastructure';
import {createCronDispatcher, INTEGRATION_CRON} from './cron_dispatcher';
import {createIntegrationRpc} from './integration_rpc';
import {createQueueDispatcher} from './queue_dispatcher';

const INGEST = 'ingest';
const WRITES = 'object-writes';

interface Harness {
  db: D1Database;
  bus: QueueBus;
  clock: FixedClock;
  fetchMock: FetchMock;
  ontology: {model: CompiledModel | null; fail: number; calls: number};
  deps: AppDeps;
  rpc: IntegrationRpc;
  queue: (b: QueueBatch<unknown>) => Promise<void>;
  cron: (cron: string, now: Date) => Promise<void>;
  drainIngest(): Promise<void>;
  writes(): ObjectWriteMsg[];
  takeWrites(): ObjectWriteMsg[];
}

function harness(): Harness {
  const db = createTestD1('integration');
  const bus = new QueueBus();
  const clock = new FixedClock('2026-09-24T00:00:00Z');
  const fetchMock = new FetchMock();
  const ontology = {
    model: supplyChainModel('t1') as CompiledModel | null,
    fail: 0,
    calls: 0,
  };
  const ontologyImpl: Pick<OntologyRpc, 'getActiveModel'> = {
    async getActiveModel(ctx: CallCtx) {
      ontology.calls++;
      if (ontology.fail > 0) {
        ontology.fail--;
        throw new Error('network: upstream unavailable');
      }
      return {
        ...supplyChainModel(ctx.tenantId),
        ...(ontology.model ?? {}),
      } as CompiledModel;
    },
  };
  const deps: AppDeps = {
    sources: new D1SourceRepository(db),
    jobs: new D1JobRepository(db),
    rawRecords: new D1RawRecordRepository(db),
    nonces: new D1NonceRepository(db),
    maintenance: new D1MaintenanceRepository(db),
    ingestQueue: new QueueIngestPublisher(bus.sender<IngestMsg>(INGEST)),
    objectWrites: new QueueObjectWritePublisher(
      bus.sender<ObjectWriteMsg>(WRITES),
    ),
    presigner: new DisabledPresigner(clock),
    rest: new HttpRestFetcher(fetchMock.fetch),
    cipher: new AesSecretCipher('test-key'),
    models: new CachedModelProvider(rpcBinding(ontologyImpl), clock, 0),
    clock,
    logger: silentLogger,
    newId: () => ulid(clock.now().getTime()),
  };
  const queue = createQueueDispatcher(deps);
  const h: Harness = {
    db,
    bus,
    clock,
    fetchMock,
    ontology,
    deps,
    rpc: rpcBinding(createIntegrationRpc(deps)),
    queue,
    cron: createCronDispatcher(deps),
    async drainIngest() {
      await bus.drain({
        [INGEST]: {
          handler: queue,
          maxBatchSize: 4,
          maxRetries: 3,
          deadLetterQueue: 'ingest-dlq',
        },
      });
    },
    writes: () => bus.peek(WRITES) as ObjectWriteMsg[],
    takeWrites() {
      const list = bus.queues.get(WRITES) ?? [];
      bus.queues.set(WRITES, []);
      return list.map(e => e.body as ObjectWriteMsg);
    },
  };
  return h;
}

const ctx = testCtx({role: 'Admin'});
const operator = testCtx({role: 'Operator', userId: 'op'});
const viewer = testCtx({role: 'Viewer', userId: 'v'});

function supplierSource(overrides: Partial<SourceDef> = {}): SourceDef {
  return {
    name: 'Suppliers',
    kind: 'file',
    config: {format: 'csv'},
    mapping: SUPPLIER_MAPPING,
    conflictPolicy: 'source-priority',
    priority: 7,
    ...overrides,
  };
}

function supplierRecords(n: number): Record<string, unknown>[] {
  const rows = readSampleCsv('suppliers.csv');
  return Array.from({length: n}, (_, i) => ({
    ...rows[i % rows.length],
    supplierId: `S-${String(i + 1).padStart(4, '0')}`,
  }));
}

function resultFor(
  msg: ObjectWriteMsg,
  rejectedRows: number[] = [],
): WriteResult {
  return {
    upserted: msg.cmds.length - rejectedRows.length,
    merged: 0,
    skipped: 0,
    rejected: rejectedRows.map(row => ({row, code: 'CONFLICT', detail: 'x'})),
  };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(AppError.from(e).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('data-integration service', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('splits a 120-record batch into 3 ingest messages and emits object writes', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    const records = supplierRecords(120);
    records[10] = {...records[10], riskScore: 'n/a'};
    records[75] = {...records[75], supplierId: ''};
    const res = await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records,
    });
    expect(res.queuedMessages).toBe(3);
    const msgs = h.bus.peek(INGEST) as IngestMsg[];
    expect(
      msgs.map(m => [m.seq, m.records.length, m.rowOffset, m.last]),
    ).toEqual([
      [0, 50, 1, false],
      [1, 50, 51, false],
      [2, 20, 101, true],
    ]);

    await h.drainIngest();
    const writes = h.writes();
    expect(writes).toHaveLength(3);
    expect(writes.map(w => w.cmds.length)).toEqual([49, 49, 20]);
    const w0 = writes[0];
    expect(w0).toMatchObject({
      jobId: res.jobId,
      policy: 'source-priority',
      schemaVersion: '1.0.0',
      ctx: {tenantId: 't1', userId: 'op'},
    });
    const cmd = w0.cmds[0];
    expect(cmd).toMatchObject({
      type: 'Supplier',
      primaryKey: 'S-0001',
      row: 1,
      props: {name: 'Shenzhen Precision Parts', country: 'CN', riskScore: 35},
      links: [
        {type: 'supplies', toType: 'Material', toKey: 'M-100', weight: 0.7},
        {type: 'supplies', toType: 'Material', toKey: 'M-101', weight: 0.7},
      ],
      provenance: {
        sourceId: src.id,
        datasetTxn: res.jobId,
        recordRef: `${res.jobId}:1`,
        ingestedAt: '2026-09-24T00:00:00.000Z',
        confidence: 1,
        priority: 7,
      },
    });
    expect(writes.every(w => w.cmds.length <= 50)).toBe(true);

    const rejected = await h.rpc.listRejected(operator, res.jobId);
    expect(rejected.map(r => [r.rowNo, r.errorCode])).toEqual([
      [11, 'TRANSFORM_FAILED'],
      [76, 'PRIMARY_KEY_MISSING'],
    ]);
    expect(rejected[0].payload.riskScore).toBe('n/a');

    const job = await h.rpc.getJob(viewer, res.jobId);
    expect(job).toMatchObject({
      status: 'Running',
      received: 120,
      rejected: 2,
      totalGroups: 3,
      doneGroups: 0,
    });
    expect(job.finishedAt).toBeUndefined();
  });

  it('completes the job after every group is reported, robust to duplicates and order', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    const records = supplierRecords(120);
    records[3] = {...records[3], supplierId: ''};
    const {jobId} = await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records,
    });
    await h.drainIngest();
    const [w0, w1, w2] = h.takeWrites();

    await h.rpc.reportWriteResult(
      w2.ctx,
      jobId,
      w2.seq,
      w2.last,
      resultFor(w2),
    );
    await h.rpc.reportWriteResult(
      w2.ctx,
      jobId,
      w2.seq,
      w2.last,
      resultFor(w2),
    );
    await h.rpc.reportWriteResult(
      w0.ctx,
      jobId,
      w0.seq,
      w0.last,
      resultFor(w0, [5]),
    );
    let job = await h.rpc.getJob(ctx, jobId);
    expect(job.status).toBe('Running');
    expect(job.doneGroups).toBe(2);

    await h.rpc.reportWriteResult(w1.ctx, jobId, w1.seq, w1.last, {
      upserted: 40,
      merged: 5,
      skipped: 5,
      rejected: [],
    });
    await h.rpc.reportWriteResult(
      w0.ctx,
      jobId,
      w0.seq,
      w0.last,
      resultFor(w0, [5]),
    );
    job = await h.rpc.getJob(ctx, jobId);
    expect(job).toMatchObject({
      status: 'PartiallyFailed',
      received: 120,
      rejected: 2,
      upserted: 48 + 40 + 20,
      merged: 5,
      skipped: 5,
      totalGroups: 3,
      doneGroups: 3,
      qualityScore: 0.9833,
    });
    expect(job.finishedAt).toBe('2026-09-24T00:00:00.000Z');
    const rejected = await h.rpc.listRejected(ctx, jobId);
    expect(rejected.map(r => r.errorCode).sort()).toEqual([
      'CONFLICT',
      'PRIMARY_KEY_MISSING',
    ]);
  });

  it('waits for every batch when batches arrive out of order', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    const {jobId} = await h.rpc.presignUpload(
      operator,
      src.id,
      'suppliers.csv',
      1000,
    );
    await h.rpc.submitBatch(operator, src.id, {
      jobId,
      seq: 1,
      last: true,
      records: supplierRecords(10),
    });
    await h.drainIngest();
    for (const w of h.takeWrites())
      await h.rpc.reportWriteResult(w.ctx, jobId, w.seq, w.last, resultFor(w));
    expect((await h.rpc.getJob(ctx, jobId)).status).toBe('Running');

    // A retried batch is not enqueued twice.
    const again = await h.rpc.submitBatch(operator, src.id, {
      jobId,
      seq: 1,
      last: true,
      records: supplierRecords(10),
    });
    expect(again.queuedMessages).toBe(1);
    expect(h.bus.size(INGEST)).toBe(0);

    await h.rpc.submitBatch(operator, src.id, {
      jobId,
      seq: 0,
      last: false,
      records: supplierRecords(500),
    });
    await h.drainIngest();
    const writes = h.takeWrites();
    expect(writes).toHaveLength(10);
    const rows = writes.flatMap(w => w.cmds.map(c => c.row));
    expect(Math.min(...rows)).toBe(1);
    expect(Math.max(...rows)).toBe(500);
    for (const w of writes)
      await h.rpc.reportWriteResult(w.ctx, jobId, w.seq, w.last, resultFor(w));
    const job = await h.rpc.getJob(ctx, jobId);
    expect(job).toMatchObject({
      status: 'Succeeded',
      received: 510,
      upserted: 510,
      qualityScore: 1,
    });
    expect(job.b2Key).toBe(`raw/t1/${src.id}/${jobId}/suppliers.csv`);
    await expectCode(
      h.rpc.submitBatch(operator, src.id, {
        jobId,
        seq: 2,
        last: true,
        records: supplierRecords(1),
      }),
      'CONFLICT',
    );
  });

  it('counts fully rejected groups as done and fails the job', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    const records = supplierRecords(5).map(r => ({...r, supplierId: ''}));
    const {jobId} = await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records,
    });
    await h.drainIngest();
    expect(h.writes()).toHaveLength(0);
    const job = await h.rpc.getJob(ctx, jobId);
    expect(job).toMatchObject({
      status: 'Failed',
      rejected: 5,
      qualityScore: 0,
      totalGroups: 0,
    });
  });

  it('dedups redelivered ingest messages', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    const {jobId} = await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records: supplierRecords(3),
    });
    const [msg] = h.bus.peek(INGEST) as IngestMsg[];
    await h.drainIngest();
    await h.bus.sender<IngestMsg>(INGEST).send(msg);
    await h.drainIngest();
    expect(h.writes()).toHaveLength(1);
    const job = await h.rpc.getJob(ctx, jobId);
    expect(job.totalGroups).toBe(1);
  });

  it('rejects all records for an unknown target type and acks', async () => {
    const src = await h.rpc.createSource(
      ctx,
      supplierSource({mapping: {...SUPPLIER_MAPPING, targetType: 'Vendor'}}),
    );
    const {jobId} = await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records: supplierRecords(4),
    });
    await h.drainIngest();
    expect(h.bus.size('ingest-dlq')).toBe(0);
    const rejected = await h.rpc.listRejected(ctx, jobId);
    expect(rejected).toHaveLength(4);
    expect(rejected[0].errorCode).toBe('SCHEMA_MISMATCH');
    expect((await h.rpc.getJob(ctx, jobId)).status).toBe('Failed');
  });

  it('retries transient ontology failures with backoff', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records: supplierRecords(2),
    });
    const retries: number[] = [];
    h.ontology.fail = 1;
    const [body] = h.bus.peek(INGEST);
    await h.queue({
      queue: INGEST,
      messages: [
        {
          id: 'm',
          body,
          attempts: 1,
          ack: () => {},
          retry: o => void retries.push(o?.delaySeconds ?? -1),
        },
      ],
      ackAll: () => {},
      retryAll: () => {},
    });
    expect(retries).toEqual([2]);
    await h.drainIngest();
    expect(h.writes()).toHaveLength(1);
  });

  it('accepts signed webhooks and rejects replays and bad signatures', async () => {
    const src = await h.rpc.createSource(
      ctx,
      supplierSource({kind: 'webhook', config: {itemsPath: '$.items'}}),
    );
    expect(src.webhookSecret).toBeTruthy();
    expect((await h.rpc.getSource(ctx, src.id)).webhookSecret).toBeUndefined();
    const stored = await h.db
      .prepare('SELECT secret_enc FROM int_source WHERE id = ?')
      .bind(src.id)
      .first<{secret_enc: string}>();
    expect(stored?.secret_enc).not.toContain(src.webhookSecret!);

    const body = JSON.stringify({items: supplierRecords(3)});
    const ts = Math.floor(h.clock.now().getTime() / 1000);
    const sig = await signWebhook(src.webhookSecret!, ts, body);
    const headers = {'X-OD-Timestamp': String(ts), 'X-OD-Signature': sig};
    const res = await h.rpc.acceptWebhook(src.id, headers, body);
    expect(res.accepted).toBe(3);
    const [msg] = h.bus.peek(INGEST) as IngestMsg[];
    expect(msg.ctx).toMatchObject({tenantId: 't1', userId: 'system'});
    await expectCode(h.rpc.acceptWebhook(src.id, headers, body), 'REPLAY');
    await expectCode(
      h.rpc.acceptWebhook(
        src.id,
        {...headers, 'X-OD-Signature': 'ab'.repeat(32)},
        body,
      ),
      'SIGNATURE_INVALID',
    );
    const old = ts - 600;
    await expectCode(
      h.rpc.acceptWebhook(
        src.id,
        {
          'X-OD-Timestamp': String(old),
          'X-OD-Signature': await signWebhook(src.webhookSecret!, old, body),
        },
        body,
      ),
      'SIGNATURE_INVALID',
    );
    const file = await h.rpc.createSource(ctx, supplierSource());
    await expectCode(
      h.rpc.acceptWebhook(file.id, headers, body),
      'SOURCE_NOT_FOUND',
    );

    await h.drainIngest();
    const [w] = h.takeWrites();
    await h.rpc.reportWriteResult(
      w.ctx,
      res.jobId,
      w.seq,
      w.last,
      resultFor(w),
    );
    expect((await h.rpc.getJob(ctx, res.jobId)).status).toBe('Succeeded');
  });

  it('pulls REST sources with decrypted secret headers and persists the cursor', async () => {
    const src = await h.rpc.createSource(
      ctx,
      supplierSource({
        kind: 'rest',
        config: {
          url: 'https://erp.example/api/suppliers?x=1',
          headers: {'x-plain': 'p'},
          secretHeaders: {authorization: 'Bearer top-secret'},
          itemsPath: '$.data.items',
          cursorParam: 'since',
          cursorPath: '$.data.next',
          pageLimit: 2,
        },
      }),
    );
    expect(JSON.stringify(src)).not.toContain('top-secret');
    let page = 0;
    h.fetchMock.respond(
      () =>
        new Response(
          JSON.stringify({
            data: {items: supplierRecords(3), next: `c${++page}`},
          }),
          {status: 200, headers: {'content-type': 'application/json'}},
        ),
    );
    await h.cron(INTEGRATION_CRON, h.clock.now());
    expect(h.fetchMock.calls).toHaveLength(1);
    expect(h.fetchMock.calls[0].url).toBe(
      'https://erp.example/api/suppliers?x=1',
    );
    expect(h.fetchMock.calls[0].headers).toMatchObject({
      authorization: 'Bearer top-secret',
      'x-plain': 'p',
    });
    expect((await h.rpc.getSource(ctx, src.id)).cursor).toBe('c1');
    const msgs = h.bus.peek(INGEST) as IngestMsg[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].records).toHaveLength(2);

    await h.cron(INTEGRATION_CRON, h.clock.now());
    expect(h.fetchMock.calls[1].url).toBe(
      'https://erp.example/api/suppliers?x=1&since=c1',
    );
    expect((await h.rpc.getSource(ctx, src.id)).cursor).toBe('c2');
    const jobs = await h.rpc.listJobs(ctx, {sourceId: src.id});
    expect(jobs).toHaveLength(2);

    h.fetchMock.respond(() => new Response('nope', {status: 500}));
    await h.cron(INTEGRATION_CRON, h.clock.now());
    expect((await h.rpc.getSource(ctx, src.id)).cursor).toBe('c2');
    const runs = await h.db
      .prepare(
        "SELECT job, status, detail FROM ops_job_run WHERE job = 'rest-pull' ORDER BY started_at",
      )
      .all<{status: string; detail: string}>();
    expect(runs.results).toHaveLength(3);
    expect(runs.results[2].status).toBe('error');
    expect(JSON.parse(runs.results[0].detail)).toMatchObject({
      sources: 1,
      jobs: 1,
      records: 2,
    });
  });

  it('replays rejected records with fixes into a new job', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    const records = supplierRecords(4);
    records[1] = {...records[1], riskScore: 'bad'};
    records[2] = {...records[2], status: 'retired'};
    const {jobId} = await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records,
    });
    await h.drainIngest();
    h.takeWrites();
    const rejected = await h.rpc.listRejected(operator, jobId);
    expect(rejected).toHaveLength(2);
    const fix = {
      id: rejected[0].id,
      payload: {...rejected[0].payload, riskScore: '44'},
    };
    const res = await h.rpc.replayRejected(operator, jobId, [fix]);
    expect(res.requeued).toBe(2);
    expect(await h.rpc.listRejected(operator, jobId)).toHaveLength(0);
    await h.drainIngest();
    const [w] = h.takeWrites();
    expect(w.jobId).not.toBe(jobId);
    expect(w.cmds.map(c => [c.primaryKey, c.props.riskScore])).toEqual([
      ['S-0002', 44],
    ]);
    const replayJob = await h.rpc.getJob(ctx, w.jobId);
    expect(replayJob).toMatchObject({
      txnType: 'APPEND',
      received: 2,
      rejected: 1,
    });
    await expectCode(
      h.rpc.replayRejected(operator, jobId, [{id: 'nope', payload: {}}]),
      'VALIDATION_FAILED',
    );
  });

  it('reports data health and staleness', async () => {
    const a = await h.rpc.createSource(ctx, supplierSource({name: 'A'}));
    const b = await h.rpc.createSource(ctx, supplierSource({name: 'B'}));
    const {jobId} = await h.rpc.submitBatch(operator, a.id, {
      seq: 0,
      last: true,
      records: supplierRecords(2),
    });
    await h.drainIngest();
    for (const w of h.takeWrites())
      await h.rpc.reportWriteResult(w.ctx, jobId, w.seq, w.last, resultFor(w));
    let health = await h.rpc.dataHealth(viewer);
    const ha = health.find(x => x.sourceId === a.id)!;
    const hb = health.find(x => x.sourceId === b.id)!;
    expect(ha).toMatchObject({
      stale: false,
      lastStatus: 'Succeeded',
      qualityScore: 1,
      enabled: true,
    });
    expect(hb).toMatchObject({stale: true, qualityScore: null});
    h.clock.advance(25 * 3_600_000);
    health = await h.rpc.dataHealth(viewer);
    expect(health.find(x => x.sourceId === a.id)!.stale).toBe(true);
  });

  it('isolates tenants', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    const {jobId} = await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records: supplierRecords(1),
    });
    const other = testCtx({tenantId: 't2', role: 'Admin'});
    expect(await h.rpc.listSources(other)).toEqual([]);
    expect(await h.rpc.listJobs(other)).toEqual([]);
    await expectCode(h.rpc.getSource(other, src.id), 'SOURCE_NOT_FOUND');
    await expectCode(h.rpc.getJob(other, jobId), 'NOT_FOUND');
    await expectCode(
      h.rpc.submitBatch(other, src.id, {
        seq: 0,
        last: true,
        records: supplierRecords(1),
      }),
      'SOURCE_NOT_FOUND',
    );
    await expectCode(
      h.rpc.reportWriteResult(other, jobId, 0, true, {
        upserted: 1,
        merged: 0,
        skipped: 0,
        rejected: [],
      }),
      'NOT_FOUND',
    );
    await expectCode(h.rpc.deleteSource(other, src.id), 'SOURCE_NOT_FOUND');
    expect(await h.rpc.pauseSourcesForTypes(other, ['Supplier'])).toEqual({
      paused: 0,
    });
    expect(await h.rpc.dataHealth(other)).toEqual([]);
  });

  it('enforces roles, limits and source state through the RPC boundary', async () => {
    await expectCode(
      h.rpc.createSource(operator, supplierSource()),
      'FORBIDDEN',
    );
    const src = await h.rpc.createSource(ctx, supplierSource());
    await expectCode(
      h.rpc.submitBatch(viewer, src.id, {
        seq: 0,
        last: true,
        records: supplierRecords(1),
      }),
      'FORBIDDEN',
    );
    await expectCode(h.rpc.listRejected(viewer, 'x'), 'FORBIDDEN');
    await expectCode(
      h.rpc.submitBatch(operator, src.id, {
        seq: 0,
        last: true,
        records: supplierRecords(501),
      }),
      'BATCH_TOO_LARGE',
    );
    await expectCode(
      h.rpc.submitBatch(operator, 'missing', {
        seq: 0,
        last: true,
        records: supplierRecords(1),
      }),
      'SOURCE_NOT_FOUND',
    );
    await expectCode(
      h.rpc.createSource(
        ctx,
        supplierSource({
          mapping: {
            ...SUPPLIER_MAPPING,
            primaryKey: {from: 'a', transform: 'nope'},
          },
        }),
      ),
      'VALIDATION_FAILED',
    );
    await expectCode(
      h.rpc.createSource(
        ctx,
        supplierSource({
          kind: 'rest',
          config: {url: 'https://x', itemsPath: '$', pageLimit: 501},
        }),
      ),
      'VALIDATION_FAILED',
    );

    expect(await h.rpc.pauseSourcesForTypes(ctx, ['Material'])).toEqual({
      paused: 1,
    });
    expect((await h.rpc.getSource(ctx, src.id)).paused).toBe(true);
    await expectCode(
      h.rpc.submitBatch(operator, src.id, {
        seq: 0,
        last: true,
        records: supplierRecords(1),
      }),
      'CONFLICT',
    );
    const updated = await h.rpc.updateSource(ctx, src.id, {
      mapping: SUPPLIER_MAPPING,
    });
    expect(updated.paused).toBe(false);
    await h.rpc.updateSource(ctx, src.id, {enabled: false});
    await expectCode(
      h.rpc.submitBatch(operator, src.id, {
        seq: 0,
        last: true,
        records: supplierRecords(1),
      }),
      'CONFLICT',
    );
    await expectCode(
      h.rpc.updateSource(ctx, src.id, {kind: 'rest'}),
      'VALIDATION_FAILED',
    );
    await h.rpc.deleteSource(ctx, src.id);
    await expectCode(h.rpc.getSource(ctx, src.id), 'SOURCE_NOT_FOUND');
  });

  it('keeps secret headers on update unless replaced', async () => {
    const src = await h.rpc.createSource(
      ctx,
      supplierSource({
        kind: 'rest',
        config: {
          url: 'https://erp.example/s',
          itemsPath: '$',
          secretHeaders: {'x-key': 'k1'},
        },
      }),
    );
    await h.rpc.updateSource(ctx, src.id, {name: 'Renamed'});
    const secrets = await h.deps.cipher.open(
      (await h.deps.sources.get(ctx, src.id))!.secretEnc!,
    );
    expect(secrets.secretHeaders).toEqual({'x-key': 'k1'});
    await h.rpc.updateSource(ctx, src.id, {
      config: {
        url: 'https://erp.example/s',
        itemsPath: '$',
        secretHeaders: {'x-key': 'k2'},
      },
    });
    const again = await h.deps.cipher.open(
      (await h.deps.sources.get(ctx, src.id))!.secretEnc!,
    );
    expect(again.secretHeaders).toEqual({'x-key': 'k2'});
  });

  it('presigns uploads (disabled and B2 signer) and cleans up expired data', async () => {
    const src = await h.rpc.createSource(ctx, supplierSource());
    const res = await h.rpc.presignUpload(
      operator,
      src.id,
      '../evil name.csv',
      10,
    );
    expect(res.url).toBe('');
    expect(res.key).toBe(`raw/t1/${src.id}/${res.jobId}/evil_name.csv`);
    expect(res.expiresAt).toBe('2026-09-24T00:15:00.000Z');
    await expectCode(
      h.rpc.presignUpload(operator, src.id, 'a.csv', 30 * 1024 * 1024),
      'VALIDATION_FAILED',
    );

    const signed: string[] = [];
    const presigner = new B2Presigner({
      signer: {
        async sign(url, init) {
          signed.push(
            `${init.method} ${url} ${init.aws.region} ${init.aws.datetime}`,
          );
          return new Request(`${url}&X-Amz-Signature=abc`, {
            method: init.method,
          });
        },
      },
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      bucket: 'raw-bucket',
      clock: h.clock,
    });
    const p = await presigner.presignPut('raw/t1/s/j/a b.csv', 10, 900);
    expect(signed[0]).toBe(
      'PUT https://s3.us-west-004.backblazeb2.com/raw-bucket/raw/t1/s/j/a%20b.csv?X-Amz-Expires=900 us-west-004 20260924T000000Z',
    );
    expect(p.url).toContain('X-Amz-Signature=abc');

    const records = supplierRecords(1).map(r => ({...r, supplierId: ''}));
    const {jobId} = await h.rpc.submitBatch(operator, src.id, {
      seq: 0,
      last: true,
      records,
    });
    await h.drainIngest();
    await h.deps.nonces.claim('sig-old', src.id, h.clock.now().getTime());
    h.clock.advance(31 * 24 * 3_600_000);
    await h.cron(INTEGRATION_CRON, h.clock.now());
    expect(await h.rpc.listRejected(ctx, jobId)).toHaveLength(0);
    const nonces = await h.db
      .prepare('SELECT COUNT(*) AS n FROM int_webhook_nonce')
      .first<{n: number}>();
    expect(nonces?.n).toBe(0);
    const run = await h.db
      .prepare("SELECT status, detail FROM ops_job_run WHERE job = 'cleanup'")
      .first<{status: string; detail: string}>();
    expect(run?.status).toBe('ok');
    expect(JSON.parse(run!.detail)).toMatchObject({rawRecords: 1, nonces: 1});
  });
});
