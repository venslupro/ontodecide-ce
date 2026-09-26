/**
 * @fileoverview Integration test of the situation context over D1
 * (node:sqlite), QueueBus, fake Durable Objects and a stub ObjectGraphRpc.
 */

import type {
  ActionResult,
  AggregateQuery,
  ApplyActionCmd,
  ObjectDto,
  ObjectGraphRpc,
  ObjectPage,
  SituationEventMsg,
} from '@ontodecide/object-graph/contract';
import {
  AppError,
  type CallCtx,
  DAY_MS,
  FixedClock,
  type ObjectSetDef,
  type Rid,
  matchFilter,
  silentLogger,
} from '@ontodecide/shared-kernel';
import {
  FakeDoNamespace,
  MemorySqlStorage,
  QueueBus,
  createTestD1,
  rpcBinding,
  testCtx,
} from '@ontodecide/testing';
import {beforeEach, describe, expect, it} from 'vitest';
import type {SituationDeps} from '../application';
import type {
  AutomationDef,
  DecisionJobMsg,
  KpiDef,
  SituationRpc,
  WsMsg,
} from '../contract';
import {
  SituationRoomCore,
  UsageGuardCore,
  createD1Repositories,
} from '../infrastructure';
import {createCronHandler} from './cron';
import {createQueueHandler} from './queue';
import {createSituationRpc} from './rpc';

/** Templates of the built-in supply-chain pack (copied). */
const PACK_AUTOMATIONS: AutomationDef[] = [
  {
    name: {'zh-CN': '供应商风险过高', 'en-US': 'Supplier risk high'},
    trigger: {kind: 'threshold', objectType: 'Supplier'},
    condition: {op: 'gte', prop: 'riskScore', value: 70},
    effects: [
      {kind: 'alert'},
      {kind: 'recommend', perturbation: {property: 'capacity', change: -0.6}},
    ],
    severity: 'HIGH',
    cooldownSec: 3600,
    enabled: true,
  },
  {
    name: {'zh-CN': '库存不足', 'en-US': 'Low inventory'},
    trigger: {kind: 'threshold', objectType: 'Product'},
    condition: {op: 'lt', prop: 'inventoryDays', value: 5},
    effects: [{kind: 'alert'}],
    severity: 'MEDIUM',
    cooldownSec: 3600,
    enabled: true,
  },
];

const PACK_KPIS: KpiDef[] = [
  {
    name: {'zh-CN': '高风险供应商', 'en-US': 'High-risk suppliers'},
    objectSet: {
      objectType: 'Supplier',
      filter: {op: 'gte', prop: 'riskScore', value: 70},
    },
    aggregate: {fn: 'count'},
    target: 0,
    higherIsBetter: false,
  },
  {
    name: {'zh-CN': '平均供应商风险', 'en-US': 'Average supplier risk'},
    objectSet: {objectType: 'Supplier'},
    aggregate: {fn: 'avg', prop: 'riskScore'},
    target: 40,
    higherIsBetter: false,
  },
  {
    name: {'zh-CN': '缺货风险产品', 'en-US': 'Products at risk'},
    objectSet: {
      objectType: 'Product',
      filter: {op: 'lt', prop: 'inventoryDays', value: 7},
    },
    aggregate: {fn: 'count'},
    target: 0,
    higherIsBetter: false,
  },
  {
    name: {'zh-CN': '日需求总量', 'en-US': 'Total daily demand'},
    objectSet: {objectType: 'Product'},
    aggregate: {fn: 'sum', prop: 'dailyDemand'},
    unit: 'units',
    higherIsBetter: true,
  },
];

const S1 = 'ri.t1.Supplier.S1' as Rid;
const S2 = 'ri.t1.Supplier.S2' as Rid;
const P1 = 'ri.t1.Product.P1' as Rid;

/** In-memory ObjectGraphRpc subset. */
class StubObjects {
  readonly objects = new Map<Rid, ObjectDto>();
  readonly actions: {ctx: CallCtx; cmd: ApplyActionCmd}[] = [];

  put(rid: Rid, type: string, title: string, props: Record<string, unknown>) {
    this.objects.set(rid, {
      rid,
      type,
      primaryKey: rid,
      title,
      props,
      provenance: {},
      version: 1,
      schemaVersion: '1.0.0',
      updatedAt: '2026-09-24T00:00:00.000Z',
    });
  }

  private select(set: ObjectSetDef): ObjectDto[] {
    return [...this.objects.values()].filter(
      o => o.type === set.objectType && matchFilter(set.filter, o.props),
    );
  }

  async aggregate(_ctx: CallCtx, q: AggregateQuery): Promise<number> {
    const items = this.select(q.objectSet);
    if (q.fn === 'count') return items.length;
    const values = items
      .map(o => o.props[q.prop ?? ''])
      .filter((v): v is number => typeof v === 'number');
    if (values.length === 0) return 0;
    if (q.fn === 'sum') return values.reduce((a, b) => a + b, 0);
    if (q.fn === 'avg')
      return values.reduce((a, b) => a + b, 0) / values.length;
    return q.fn === 'min' ? Math.min(...values) : Math.max(...values);
  }

  async evaluateObjectSet(
    _ctx: CallCtx,
    def: ObjectSetDef,
    page?: {limit?: number},
  ): Promise<ObjectPage> {
    return {
      items: this.select(def).slice(0, page?.limit ?? 50),
      nextCursor: null,
    };
  }

  async applyAction(ctx: CallCtx, cmd: ApplyActionCmd): Promise<ActionResult> {
    this.actions.push({ctx, cmd});
    if (cmd.actionType === 'boom') throw new AppError('PRECONDITION_FAILED');
    return {
      actionLogId: 'al1',
      actionType: cmd.actionType,
      rid: cmd.target,
      version: 2,
      before: {},
      after: {},
      writebackStatus: 'NONE',
      executedAt: '2026-09-24T00:00:00.000Z',
    };
  }
}

function event(
  eventId: string,
  changes: SituationEventMsg['changes'],
  usage?: SituationEventMsg['usage'],
): SituationEventMsg {
  return {
    eventId,
    tenantId: 't1',
    kind: 'ObjectsUpserted',
    occurredAt: '2026-09-24T10:00:00.000Z',
    correlationId: 'c1',
    changes,
    ...(usage ? {usage} : {}),
  };
}

function supplierChange(riskScore: number, rid: Rid = S1) {
  return {
    rid,
    type: 'Supplier',
    title: rid === S1 ? 'Acme' : 'Beta',
    changed: ['riskScore'],
    after: {name: 'Acme', riskScore, capacity: 100},
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

describe('situation context', () => {
  let clock: FixedClock;
  let bus: QueueBus;
  let objects: StubObjects;
  let frames: Map<string, WsMsg[]>;
  let deps: SituationDeps;
  let rpc: SituationRpc;
  let consume: (msg: SituationEventMsg) => Promise<void>;
  const ctx = testCtx();

  beforeEach(async () => {
    clock = new FixedClock('2026-09-24T10:00:00Z');
    bus = new QueueBus();
    objects = new StubObjects();
    objects.put(S1, 'Supplier', 'Acme', {riskScore: 30, capacity: 100});
    objects.put(S2, 'Supplier', 'Beta', {riskScore: 10, capacity: 50});
    objects.put(P1, 'Product', 'Widget', {inventoryDays: 3, dailyDemand: 40});
    frames = new Map();
    const rooms = new FakeDoNamespace(
      tenant =>
        new SituationRoomCore(
          new MemorySqlStorage(),
          {
            broadcast: f => {
              const list = frames.get(tenant) ?? [];
              list.push(JSON.parse(f) as WsMsg);
              frames.set(tenant, list);
            },
          },
          clock,
        ),
    );
    const usage = new FakeDoNamespace(
      () => new UsageGuardCore(new MemorySqlStorage(), {clock}),
    );
    deps = {
      repos: createD1Repositories(createTestD1('situation')),
      objects: rpcBinding(objects) as unknown as ObjectGraphRpc,
      rooms: t => rooms.getByName(t),
      usage: () => usage.getByName('global'),
      decisionJobs: bus.sender<DecisionJobMsg>('decision-jobs'),
      replayTargets: {
        ingest: bus.sender('ingest'),
        'object-writes': bus.sender('object-writes'),
        'graph-sync': bus.sender('graph-sync'),
        'situation-events': bus.sender('situation-events'),
        'decision-jobs': bus.sender('decision-jobs'),
      },
      clock,
      logger: silentLogger,
    };
    rpc = rpcBinding(createSituationRpc(deps));
    const handler = createQueueHandler(deps);
    consume = async msg => {
      await bus.sender('situation-events').send(msg);
      await bus.drain({'situation-events': {handler}});
    };
    expect(
      await rpc.installPackContent(ctx, {
        automations: PACK_AUTOMATIONS,
        kpis: PACK_KPIS,
      }),
    ).toEqual({automations: 2, kpis: 4});
  });

  const wsTypes = () => (frames.get('t1') ?? []).map(m => m.type);

  it('installs pack content idempotently and validates templates', async () => {
    expect(
      await rpc.installPackContent(ctx, {
        automations: PACK_AUTOMATIONS,
        kpis: PACK_KPIS,
      }),
    ).toEqual({automations: 0, kpis: 0});
    expect(await rpc.listAutomations(ctx)).toHaveLength(2);
    await expectCode(
      rpc.installPackContent(ctx, {automations: [{name: 'x'}]}),
      'VALIDATION_FAILED',
    );
    await expectCode(
      rpc.installPackContent(testCtx({role: 'Operator'}), {}),
      'FORBIDDEN',
    );
  });

  it('runs the alert → decision job loop with dedupe and cooldown', async () => {
    objects.put(S1, 'Supplier', 'Acme', {riskScore: 82, capacity: 100});
    await consume(
      event('e1', [supplierChange(82)], [{resource: 'd1.rowsWritten', n: 3}]),
    );

    let alerts = await rpc.listAlerts(ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      rid: S1,
      title: 'Acme',
      severity: 'HIGH',
      status: 'OPEN',
      hits: 1,
      snapshot: {riskScore: 82},
      automationName: {'en-US': 'Supplier risk high'},
    });
    const jobs = bus.peek('decision-jobs') as DecisionJobMsg[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      alertId: alerts[0].id,
      focus: S1,
      perturbation: {property: 'capacity', change: -0.6},
      ctx: {tenantId: 't1', userId: 'system', correlationId: 'e1'},
    });
    expect(typeof jobs[0].jobId).toBe('string');
    expect(wsTypes()).toContain('alert');
    expect(wsTypes()).toContain('kpi');
    expect((await rpc.getUsage(ctx)).used['d1.rowsWritten']).toBe(3);
    const autos = await rpc.listAutomations(ctx);
    expect(autos.find(a => a.severity === 'HIGH')?.lastFiredAt).toBe(
      '2026-09-24T10:00:00.000Z',
    );

    // Same eventId: ignored.
    await consume(event('e1', [supplierChange(82)]));
    expect((await rpc.listAlerts(ctx))[0].hits).toBe(1);
    expect((await rpc.getUsage(ctx)).used['d1.rowsWritten']).toBe(3);

    // New event while OPEN: hits++, no new alert or job.
    await consume(event('e2', [supplierChange(85)]));
    alerts = await rpc.listAlerts(ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].hits).toBe(2);
    expect(alerts[0].snapshot.riskScore).toBe(85);
    expect(bus.size('decision-jobs')).toBe(1);

    // Change of an unrelated property: rule skipped.
    await consume(event('e2b', [{...supplierChange(85), changed: ['name']}]));
    expect((await rpc.listAlerts(ctx))[0].hits).toBe(2);

    // Ack then close; re-hit within cooldown only updates the alert.
    const acked = await rpc.updateAlert(ctx, alerts[0].id, {status: 'ACKED'});
    expect(acked).toMatchObject({status: 'ACKED', ackedBy: 'u1'});
    const closed = await rpc.updateAlert(ctx, alerts[0].id, {status: 'CLOSED'});
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).toBe('2026-09-24T10:00:00.000Z');
    await expectCode(
      rpc.updateAlert(ctx, alerts[0].id, {status: 'ACKED'}),
      'INVALID_TRANSITION',
    );

    clock.advance(10 * 60_000);
    await consume(event('e3', [supplierChange(90)]));
    alerts = await rpc.listAlerts(ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({status: 'CLOSED', hits: 3});
    expect(alerts[0].snapshot.riskScore).toBe(90);
    expect(bus.size('decision-jobs')).toBe(1);

    // After the cooldown a new alert fires again.
    clock.advance(3600_000);
    await consume(event('e4', [supplierChange(91)]));
    alerts = await rpc.listAlerts(ctx);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({status: 'OPEN', hits: 1});
    expect(bus.size('decision-jobs')).toBe(2);
  });

  it('refreshes KPIs and writes trend points', async () => {
    objects.put(S1, 'Supplier', 'Acme', {riskScore: 82, capacity: 100});
    await consume(event('e1', [supplierChange(82)]));
    const kpis = await rpc.listKpis(ctx);
    const byName = (n: string) =>
      kpis.find(k => typeof k.name === 'object' && k.name['en-US'] === n)!;
    expect(byName('High-risk suppliers')).toMatchObject({
      value: 1,
      target: 0,
      higherIsBetter: false,
      updatedAt: '2026-09-24T10:00:00.000Z',
      spark: [1],
    });
    expect(byName('Average supplier risk').value).toBe(46);
    // Product KPIs are untouched by a Supplier event.
    expect(byName('Products at risk').value).toBeNull();

    const trend = await rpc.kpiTrend(
      ctx,
      byName('High-risk suppliers').id,
      '24h',
    );
    expect(trend).toEqual([{ts: '2026-09-24T10:00:00.000Z', value: 1}]);
    const kpiFrames = (frames.get('t1') ?? []).filter(m => m.type === 'kpi');
    expect(kpiFrames).toHaveLength(2);

    // Previous value 24 h later.
    clock.advance(DAY_MS);
    const later = await rpc.refreshKpis(ctx);
    expect(
      later.find(k => k.id === byName('High-risk suppliers').id),
    ).toMatchObject({value: 1, previous: 1});
    await expectCode(rpc.kpiTrend(ctx, 'nope', '24h'), 'NOT_FOUND');
    await expectCode(rpc.refreshKpis(testCtx({role: 'Operator'})), 'FORBIDDEN');
  });

  it('saves and deletes KPIs', async () => {
    const saved = await rpc.saveKpi(ctx, {
      name: 'Products',
      objectSet: {objectType: 'Product'},
      aggregate: {fn: 'count'},
    });
    expect(saved).toMatchObject({value: 1, higherIsBetter: true});
    expect(await rpc.listKpis(ctx)).toHaveLength(5);
    await rpc.deleteKpi(ctx, saved.id);
    expect(await rpc.listKpis(ctx)).toHaveLength(4);
    await expectCode(rpc.deleteKpi(ctx, saved.id), 'NOT_FOUND');
    await expectCode(
      rpc.saveKpi(ctx, {name: '', objectSet: {objectType: 'X'}} as KpiDef),
      'VALIDATION_FAILED',
    );
  });

  it('pushes recommendations and links the alert', async () => {
    objects.put(S1, 'Supplier', 'Acme', {riskScore: 82, capacity: 100});
    await consume(event('e1', [supplierChange(82)]));
    const [alert] = await rpc.listAlerts(ctx);
    await rpc.pushRecommendation(ctx, {
      id: 'rec1',
      status: 'Proposed',
      summary: 'Switch supplier',
      confidence: 0.8,
      focus: S1,
      alertId: alert.id,
      expectedImpact: 0.3,
      createdAt: '2026-09-24T10:00:00.000Z',
    });
    expect((await rpc.listAlerts(ctx))[0].recommendationId).toBe('rec1');
    expect(wsTypes()).toContain('recommendation');

    const overview = await rpc.overview(testCtx({role: 'Viewer'}));
    expect(Object.keys(overview).sort()).toEqual([
      'alerts',
      'generatedAt',
      'kpis',
      'recommendations',
      'usage',
    ]);
    expect(overview.kpis).toHaveLength(4);
    expect(overview.alerts.map(a => a.id)).toEqual([alert.id]);
    expect(overview.recommendations.map(r => r.id)).toEqual(['rec1']);
    expect(overview.usage).toMatchObject({day: '2026-09-24', level: 'ok'});
    expect(overview.generatedAt).toBe('2026-09-24T10:00:00.000Z');

    await rpc.pushRecommendation(ctx, {
      id: 'rec1',
      status: 'Executed',
      summary: 'Switch supplier',
      confidence: 0.8,
      focus: S1,
      expectedImpact: 0.3,
      createdAt: '2026-09-24T10:00:00.000Z',
    });
    expect((await rpc.overview(ctx)).recommendations).toEqual([]);
  });

  it('sorts overview alerts by severity then time', async () => {
    objects.put(P1, 'Product', 'Widget', {inventoryDays: 2, dailyDemand: 40});
    await consume(
      event('p1', [
        {
          rid: P1,
          type: 'Product',
          title: 'Widget',
          changed: ['inventoryDays'],
          after: {inventoryDays: 2},
        },
      ]),
    );
    clock.advance(60_000);
    await consume(event('e1', [supplierChange(82)]));
    const overview = await rpc.overview(ctx);
    expect(overview.alerts.map(a => a.severity)).toEqual(['HIGH', 'MEDIUM']);
  });

  it('manages automations, dry runs and action effects', async () => {
    const dto = await rpc.saveAutomation(ctx, {
      name: 'Critical risk',
      trigger: {kind: 'threshold', objectType: 'Supplier'},
      condition: {op: 'gte', prop: 'riskScore', value: 95},
      effects: [
        {kind: 'action', actionType: 'boom'},
        {kind: 'action', actionType: 'flagSupplier', params: {flag: true}},
      ],
      severity: 'CRITICAL',
    });
    expect(dto).toMatchObject({cooldownSec: 3600, enabled: true});

    expect(
      await rpc.dryRunAutomation(ctx, {
        name: 'dry',
        trigger: {kind: 'threshold', objectType: 'Supplier'},
        condition: {op: 'gte', prop: 'riskScore', value: 20},
        effects: [{kind: 'alert'}],
        severity: 'LOW',
      }),
    ).toEqual({wouldFire: 1, sample: ['Acme']});
    expect(
      await rpc.dryRunAutomation(ctx, {
        name: 'dry',
        trigger: {
          kind: 'objectSetCount',
          objectSet: {objectType: 'Supplier'},
          op: 'gt',
          value: 1,
        },
        effects: [{kind: 'alert'}],
        severity: 'LOW',
      }),
    ).toMatchObject({wouldFire: 1});

    await consume(event('e1', [supplierChange(97)]));
    expect(objects.actions.map(a => a.cmd.actionType)).toEqual([
      'boom',
      'flagSupplier',
    ]);
    expect(objects.actions[1]).toMatchObject({
      ctx: {userId: 'system', tenantId: 't1'},
      cmd: {target: S1, params: {flag: true}},
    });
    // The failing action did not block the event.
    expect(await rpc.listAlerts(ctx, {severity: 'CRITICAL'})).toHaveLength(1);

    const updated = await rpc.saveAutomation(ctx, {
      ...dto,
      enabled: false,
    });
    expect(updated).toMatchObject({id: dto.id, enabled: false});
    await rpc.deleteAutomation(ctx, dto.id);
    await expectCode(rpc.deleteAutomation(ctx, dto.id), 'NOT_FOUND');
    await expectCode(
      rpc.saveAutomation(testCtx({role: 'Viewer'}), dto),
      'FORBIDDEN',
    );
    await expectCode(
      rpc.saveAutomation(ctx, {
        ...dto,
        id: undefined,
        condition: {op: 'bogus'} as never,
      }),
      'VALIDATION_FAILED',
    );
  });

  it('raises objectSetCount alerts without focus', async () => {
    await rpc.saveAutomation(ctx, {
      name: 'Too many suppliers',
      trigger: {
        kind: 'objectSetCount',
        objectSet: {objectType: 'Supplier'},
        op: 'gt',
        value: 1,
      },
      effects: [{kind: 'alert'}, {kind: 'recommend'}],
      severity: 'LOW',
    });
    await consume(event('e1', [supplierChange(10)]));
    await consume(event('e2', [supplierChange(11)]));
    const alerts = await rpc.listAlerts(ctx, {severity: 'LOW'});
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({rid: null, hits: 2, snapshot: {count: 2}});
    expect(bus.size('decision-jobs')).toBe(0);
  });

  it('stores dead letters and replays them to the right queue', async () => {
    const handler = createQueueHandler(deps);
    const body = {ctx: testCtx(), sourceId: 's1', jobId: 'j1', seq: 1};
    await bus.sender('ingest-dlq').send(body);
    await bus.sender('graph-sync-dlq').send({tenantId: 't2'});
    await bus.drain({
      'ingest-dlq': {handler},
      'graph-sync-dlq': {handler},
    });
    const letters = await rpc.listDeadLetters(ctx);
    expect(letters).toHaveLength(1);
    expect(letters[0]).toMatchObject({queue: 'ingest', body, attempts: 1});
    expect(
      await rpc.listDeadLetters(testCtx({tenantId: 't2'}), 'graph-sync'),
    ).toHaveLength(1);

    expect(await rpc.replayDeadLetters(ctx, 'ingest-dlq')).toEqual({
      replayed: 1,
    });
    expect(bus.peek('ingest')).toEqual([body]);
    expect((await rpc.listDeadLetters(ctx, 'ingest'))[0].replayedAt).toBe(
      '2026-09-24T10:00:00.000Z',
    );
    expect(await rpc.replayDeadLetters(ctx, 'ingest')).toEqual({replayed: 0});
    await expectCode(rpc.replayDeadLetters(ctx, 'nope'), 'VALIDATION_FAILED');
    await expectCode(
      rpc.listDeadLetters(testCtx({role: 'Modeler'})),
      'FORBIDDEN',
    );
  });

  it('dead-letters failing situation events after retries', async () => {
    const failing = {
      ...deps,
      objects: {
        ...deps.objects,
        aggregate: async () => {
          throw new Error('graph down');
        },
      } as unknown as ObjectGraphRpc,
    };
    const handler = createQueueHandler(failing);
    const store = createQueueHandler(deps);
    await bus
      .sender('situation-events')
      .send(event('bad', [{...supplierChange(10), type: 'Supplier'}]));
    // Count rule forces an aggregate call that fails.
    await rpc.saveAutomation(ctx, {
      name: 'count',
      trigger: {
        kind: 'objectSetCount',
        objectSet: {objectType: 'Supplier'},
        op: 'gt',
        value: 0,
      },
      effects: [{kind: 'alert'}],
      severity: 'LOW',
    });
    await bus.drain({
      'situation-events': {
        handler,
        maxRetries: 3,
        deadLetterQueue: 'situation-events-dlq',
      },
      'situation-events-dlq': {handler: store, maxRetries: 1},
    });
    const letters = await rpc.listDeadLetters(ctx, 'situation-events');
    expect(letters).toHaveLength(1);
    expect(letters[0].attempts).toBeGreaterThan(1);
  });

  it('evaluates schedules, refreshes KPIs and cleans up', async () => {
    await rpc.saveAutomation(ctx, {
      name: 'Hourly low stock',
      trigger: {kind: 'schedule', objectSet: {objectType: 'Product'}},
      condition: {op: 'lt', prop: 'inventoryDays', value: 5},
      effects: [{kind: 'alert'}],
      severity: 'MEDIUM',
    });
    const old = clock.now().getTime() - 91 * DAY_MS;
    await deps.repos.metrics.upsert('t1', 'kpi:old', old, 1);
    await deps.repos.processedEvents.add('ancient', old);

    expect(await rpc.evaluateScheduled(clock.now().toISOString())).toEqual({
      fired: 1,
    });
    expect(await rpc.evaluateScheduled(clock.now().toISOString())).toEqual({
      fired: 0,
    });
    const alerts = await rpc.listAlerts(ctx, {rid: P1});
    expect(alerts).toMatchObject([{title: 'Widget', hits: 2}]);
    expect((await rpc.listKpis(ctx)).every(k => k.value !== null)).toBe(true);
    const points = await deps.repos.metrics.range(
      't1',
      ['kpi:old'],
      0,
      clock.now().getTime(),
    );
    expect(points.size).toBe(0);
    expect(await deps.repos.processedEvents.has('ancient')).toBe(false);

    await createCronHandler(deps)('0 * * * *', clock.now());
  });

  it('serves layouts and usage', async () => {
    const layout = await rpc.getLayout(testCtx({role: 'Viewer'}));
    expect(layout.columns).toBe(12);
    expect(layout.widgets.filter(w => w.kind === 'kpi')).toHaveLength(4);
    const custom = {...layout, id: 'mine', name: 'Mine', widgets: []};
    expect(await rpc.saveLayout(ctx, custom)).toEqual(custom);
    expect(await rpc.getLayout(ctx)).toEqual(custom);
    await expectCode(
      rpc.saveLayout(ctx, {...custom, columns: 10 as 12}),
      'VALIDATION_FAILED',
    );
    await expectCode(
      rpc.saveLayout(testCtx({role: 'Operator'}), custom),
      'FORBIDDEN',
    );

    const s = await rpc.recordUsage([
      {resource: 'queues.ops', n: 9600},
      {resource: 'nope' as never, n: 1},
    ]);
    expect(s).toMatchObject({level: 'stop', used: {'queues.ops': 9600}});
    expect((await rpc.getUsage(ctx)).level).toBe('stop');
  });
});
