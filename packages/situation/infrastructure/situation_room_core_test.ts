/**
 * @fileoverview SituationRoom core tests over MemorySqlStorage: first
 * initialization from template seeds, event handling (dedupe, tombstone,
 * alert dedupe / cooldown / auto-close, KPI updates), metric points,
 * scheduled automations and the alarm, automation CRUD, alerts, stream
 * tickets, connections and resume, and the tenant lifecycle.
 */

import {beforeEach, describe, expect, it} from 'vitest';
import {
  AppError,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  STREAM_CLOSE_EXPIRED,
  sha256Hex,
} from '@ontodecide/shared-kernel';
import {MemorySqlStorage, TEST_TID, testCtx} from '@ontodecide/testing';
import {STREAM_CLOSE_REPLACED} from '../application';
import type {AutomationDef, SituationOverview, WsMsg} from '../contract/types';
import {nextBucket} from '../domain';
import type {MemorySocket} from './memory_runtime';
import {type TestRoom, event, makeRoom} from './room_test_fixtures';
import {ROOM_SCHEMA_VERSION} from './sql_room_store';

const ctx = testCtx();
const S1 = 'ri.Supplier.01K6A0000000000000000000S1';
const S2 = 'ri.Supplier.01K6A0000000000000000000S2';
const S3 = 'ri.Supplier.01K6A0000000000000000000S3';
const P1 = 'ri.Part.01K6A0000000000000000000P1';

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return AppError.from(e).code;
  }
}

function tables(sql: MemorySqlStorage): string[] {
  return sql
    .exec<{name: string}>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .toArray()
    .map(r => r.name);
}

function kpi(o: SituationOverview, id: string) {
  const k = o.kpis.find(x => x.id === id);
  if (!k) throw new Error(`missing KPI ${id}`);
  return k;
}

async function connect(r: TestRoom, sub = ctx.sub): Promise<MemorySocket> {
  const s = r.hub.accept({sub, actingAs: false, n: r.core.nextSocketNumber()});
  await r.core.connected(s);
  return s;
}

const scheduleDef = (everyHours: number): AutomationDef => ({
  name: `every ${everyHours}h`,
  trigger: 'schedule',
  objectType: 'Part',
  condition: {op: 'lt', prop: 'stock', value: 3},
  everyHours,
  severity: 'LOW',
  cooldownSec: 0,
  enabled: true,
});

describe('first initialization', () => {
  it('installs template KPIs and sample automations and computes the snapshot', async () => {
    const r = makeRoom();
    r.objects.put(S1, {risk: 20});
    r.objects.put(S2, {risk: 90});
    r.objects.put(S3, {risk: 40});
    r.objects.put(P1, {stock: 5}, 'Part');

    const o = await r.core.overview(ctx, {range: '24h'});
    expect(o.initialized).toBe(true);
    expect(r.ontology.calls.getTemplateSeeds).toEqual(['supply-chain']);
    expect(o.kpis.map(k => k.id)).toEqual([
      'kpi-suppliers',
      'kpi-avg-risk',
      'kpi-max-risk',
      'kpi-high-risk',
    ]);
    expect(kpi(o, 'kpi-suppliers').value).toBe(3);
    expect(kpi(o, 'kpi-avg-risk').value).toBe(50);
    expect(kpi(o, 'kpi-avg-risk')).toMatchObject({target: 40, unit: 'pt'});
    expect(kpi(o, 'kpi-max-risk').value).toBe(90);
    expect(kpi(o, 'kpi-high-risk').value).toBe(1);
    expect(kpi(o, 'kpi-suppliers').previous).toBeNull();
    // The threshold seed was evaluated once over the snapshot.
    expect(o.alerts).toHaveLength(1);
    expect(o.alerts[0]).toMatchObject({
      rid: S2,
      status: 'OPEN',
      severity: 'HIGH',
    });
    // Trend starts with the initial value.
    expect(
      o.trends.find(t => t.kpiId === 'kpi-suppliers')!.points,
    ).toHaveLength(1);

    const autos = await r.core.listAutomations(ctx);
    expect(autos.map(a => a.id)).toEqual(['auto-high-risk', 'auto-low-stock']);
    expect(autos[1].nextRunAt).toBe(
      new Date(r.clock.now().getTime() + 24 * HOUR_MS).toISOString(),
    );

    await r.core.overview(ctx, {range: '7d'});
    expect(r.ontology.calls.getCompiledSchema).toBe(1);
    expect(r.objects.calls.listObjects).toBe(1);
  });

  it('reads at most three pages of objects', async () => {
    const r = makeRoom();
    for (let i = 0; i < 350; i++) {
      r.objects.put(`ri.Supplier.X${String(i).padStart(4, '0')}`, {risk: 1});
    }
    const o = await r.core.overview(ctx, {range: '24h'});
    expect(r.objects.calls.listObjects).toBe(3);
    expect(kpi(o, 'kpi-suppliers').value).toBe(300);
  });

  it('shares one initialization between concurrent callers', async () => {
    const r = makeRoom();
    await Promise.all([
      r.core.overview(ctx, {range: '24h'}),
      r.core.overview(ctx, {range: '24h'}),
      r.core.listAutomations(ctx),
    ]);
    expect(r.ontology.calls.getCompiledSchema).toBe(1);
    expect((await r.core.listAutomations(ctx)).length).toBe(2);
  });

  it('reports initialized=false and retries when the template is unavailable', async () => {
    const r = makeRoom();
    r.ontology.fail = new AppError('UNAVAILABLE');
    const o = await r.core.overview(ctx, {range: '24h'});
    expect(o).toMatchObject({initialized: false, kpis: [], alerts: []});
    r.ontology.fail = null;
    expect((await r.core.overview(ctx, {range: '24h'})).initialized).toBe(true);
  });

  it('keeps at most three scheduled seeds', async () => {
    const r = makeRoom();
    const base = r.ontology.seeds.automations[1];
    r.ontology.seeds.automations = [1, 2, 3, 4].map(i => ({
      ...base,
      id: `s${i}`,
    }));
    await r.core.overview(ctx, {range: '24h'});
    expect((await r.core.listAutomations(ctx)).map(a => a.id)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });
});

describe('domain events', () => {
  let r: TestRoom;
  beforeEach(async () => {
    r = makeRoom();
    r.objects.put(S1, {risk: 20, name: 'a'});
    r.objects.put(S2, {risk: 40, name: 'b'});
    await r.core.overview(ctx, {range: '24h'});
  });

  const change = async (rid: string, props: Record<string, unknown>) => {
    r.objects.put(rid, props);
    return r.core.applyEvents(TEST_TID, [event([[rid, Object.keys(props)]])]);
  };
  const alertsOf = async (rid: string) =>
    (await r.core.listAlerts(ctx, {rid: rid as never}, {})).items;

  it('updates KPIs incrementally and pushes kpi and alert messages', async () => {
    const ws = await connect(r);
    await change(S1, {risk: 85});
    const o = await r.core.overview(ctx, {range: '24h'});
    expect(kpi(o, 'kpi-avg-risk').value).toBe(62.5);
    expect(kpi(o, 'kpi-max-risk').value).toBe(85);
    expect(kpi(o, 'kpi-high-risk').value).toBe(1);
    const types = ws.messages<WsMsg>().map(m => m.type);
    expect(types).toEqual(['snapshot', 'kpi', 'alert']);
    const seqs = ws
      .messages<WsMsg>()
      .slice(1)
      .map(m => m.seq);
    expect(seqs).toEqual([1, 2]);

    // The max leaves: recomputed from the object cache.
    await change(S1, {risk: 10});
    const o2 = await r.core.overview(ctx, {range: '24h'});
    expect(kpi(o2, 'kpi-max-risk').value).toBe(40);
    expect(kpi(o2, 'kpi-avg-risk').value).toBe(25);
  });

  it('deduplicates events by eventId', async () => {
    r.objects.put(S1, {risk: 85});
    const e = event([[S1, ['risk']]]);
    expect(await r.core.applyEvents(TEST_TID, [e, e])).toEqual({
      applied: 1,
      duplicates: 1,
      dropped: false,
    });
    const again = await r.core.applyEvents(TEST_TID, [e]);
    expect(again).toEqual({applied: 0, duplicates: 1, dropped: false});
    expect((await alertsOf(S1))[0].hits).toBe(1);
    expect(r.objects.calls.getObjects).toBe(1);
  });

  it('forgets event ids after 24 hours', async () => {
    const e = event([[S1, ['risk']]]);
    await r.core.applyEvents(TEST_TID, [e]);
    r.clock.advance(DAY_MS + MINUTE_MS);
    await r.core.applyEvents(TEST_TID, [event([[S2, ['name']]])]);
    expect(r.store.isSeen(e.eventId)).toBe(false);
  });

  it('keeps one OPEN alert per automation and object (dedupe)', async () => {
    await change(S1, {risk: 85});
    await change(S1, {risk: 95});
    await change(S1, {risk: 99});
    const list = await alertsOf(S1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({status: 'OPEN', hits: 3});
    expect(list[0].snapshot).toMatchObject({risk: 99});
    // The partial unique index backs the rule up in storage.
    const a = r.store.getAlert(list[0].id)!;
    expect(() => r.store.insertAlert({...a, id: 'dup'})).toThrow();
  });

  it('auto-closes when the condition stops holding, then cools down', async () => {
    await change(S1, {risk: 85});
    await change(S1, {risk: 50});
    let list = await alertsOf(S1);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('CLOSED');
    expect(list[0].closedAt).not.toBeNull();

    // Within the 600 s cooldown: no new alert, the closed one is updated.
    r.clock.advance(5 * MINUTE_MS);
    await change(S1, {risk: 90});
    list = await alertsOf(S1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({status: 'CLOSED', hits: 2});
    expect(list[0].snapshot).toMatchObject({risk: 90});

    // After the cooldown a new alert opens.
    await change(S1, {risk: 50});
    r.clock.advance(11 * MINUTE_MS);
    await change(S1, {risk: 91});
    list = await alertsOf(S1);
    expect(list.map(a => a.status).sort()).toEqual(['CLOSED', 'OPEN']);
  });

  it('closes acknowledged alerts too', async () => {
    await change(S1, {risk: 85});
    const [a] = await alertsOf(S1);
    await r.core.acknowledgeAlert(ctx, a.id);
    await change(S1, {risk: 90});
    expect((await alertsOf(S1))[0]).toMatchObject({status: 'ACKED', hits: 2});
    await change(S1, {risk: 1});
    expect((await alertsOf(S1))[0].status).toBe('CLOSED');
  });

  it('evaluates only rules referencing a changed property', async () => {
    await change(S1, {risk: 85});
    await change(S1, {name: 'renamed'});
    expect((await alertsOf(S1))[0].hits).toBe(1);
  });

  it('evaluates every rule of the type for new objects', async () => {
    r.objects.put(S3, {risk: 88});
    await r.core.applyEvents(TEST_TID, [event([[S3, ['name']]])]);
    expect(await alertsOf(S3)).toHaveLength(1);
    const o = await r.core.overview(ctx, {range: '24h'});
    expect(kpi(o, 'kpi-suppliers').value).toBe(3);
  });

  it('removes objects that no longer exist and closes their alerts', async () => {
    await change(S1, {risk: 85});
    r.objects.objects.delete(S1);
    await r.core.applyEvents(TEST_TID, [event([[S1, ['risk']]])]);
    const o = await r.core.overview(ctx, {range: '24h'});
    expect(kpi(o, 'kpi-suppliers').value).toBe(1);
    expect((await alertsOf(S1))[0].status).toBe('CLOSED');
    expect(r.store.getObject(S1)).toBeNull();
  });

  it('does not mark events seen when object-graph fails (retry)', async () => {
    r.objects.put(S1, {risk: 85});
    r.objects.failNext = new AppError('UNAVAILABLE');
    const e = event([[S1, ['risk']]]);
    expect(await codeOf(r.core.applyEvents(TEST_TID, [e]))).toBe('UNAVAILABLE');
    expect(r.store.isSeen(e.eventId)).toBe(false);
    expect((await r.core.applyEvents(TEST_TID, [e])).applied).toBe(1);
    expect(await alertsOf(S1)).toHaveLength(1);
  });

  it('rejects events of another workspace', async () => {
    const other = '01K6A000000000000000000T99';
    expect(
      await codeOf(
        r.core.applyEvents(other, [event([[S1, ['risk']]], {tid: other})]),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('events before initialization', () => {
  it('initialize the room from the current state', async () => {
    const r = makeRoom();
    r.objects.put(S1, {risk: 95});
    const e = event([[S1, ['risk']]]);
    expect((await r.core.applyEvents(TEST_TID, [e])).applied).toBe(1);
    expect(r.store.isSeen(e.eventId)).toBe(true);
    expect(r.objects.calls.getObjects).toBe(0);
    const o = await r.core.overview(ctx, {range: '24h'});
    expect(o.alerts).toHaveLength(1);
  });
});

describe('metric points and the alarm', () => {
  it('flushes changed KPIs at the next 15-minute boundary', async () => {
    const r = makeRoom();
    r.objects.put(S1, {risk: 10});
    await r.core.overview(ctx, {range: '24h'});
    const t0 = r.clock.now().getTime();
    // Only the seeded daily rule is scheduled.
    expect(r.storage.alarm).toBe(t0 + 24 * HOUR_MS);

    r.clock.advance(2 * MINUTE_MS);
    r.objects.put(S1, {risk: 30});
    await r.core.applyEvents(TEST_TID, [event([[S1, ['risk']]])]);
    const flushAt = nextBucket(r.clock.now().getTime());
    expect(r.storage.alarm).toBe(flushAt);

    r.clock.advance(flushAt - r.clock.now().getTime());
    const res = await r.core.alarm();
    expect(res).toMatchObject({kind: 'ran', rulesRun: 0});
    expect(res.pointsWritten).toBe(2); // avg and max changed; count did not
    expect(r.storage.alarm).toBe(t0 + 24 * HOUR_MS);

    const o = await r.core.overview(ctx, {range: '24h'});
    expect(o.trends.find(t => t.kpiId === 'kpi-avg-risk')!.points).toEqual([
      {ts: new Date(t0).toISOString(), value: 10},
      {ts: new Date(flushAt).toISOString(), value: 30},
    ]);
    // 24 h later the value 24 h ago is the flushed one.
    r.clock.advance(DAY_MS);
    const later = await r.core.overview(ctx, {range: '24h'});
    expect(kpi(later, 'kpi-avg-risk').previous).toBe(30);
    expect(kpi(later, 'kpi-suppliers').previous).toBe(1);
  });

  it('runs due scheduled rules and advances next_run_at', async () => {
    const r = makeRoom();
    r.objects.put(P1, {stock: 5}, 'Part');
    await r.core.overview(ctx, {range: '24h'});
    const hourly = await r.core.createAutomation(ctx, scheduleDef(1));
    const t0 = r.clock.now().getTime();
    expect(r.storage.alarm).toBe(t0 + HOUR_MS);

    r.clock.advance(HOUR_MS);
    const ws = await connect(r);
    // Due, but stock 5 is not < 3: nothing raised.
    expect((await r.core.alarm()).rulesRun).toBe(1);
    expect((await r.core.listAlerts(ctx, {}, {})).items).toHaveLength(0);
    r.objects.put(P1, {stock: 2}, 'Part');
    await r.core.applyEvents(TEST_TID, [event([[P1, ['stock'], 'Part']])]);
    expect((await r.core.listAlerts(ctx, {}, {})).items).toHaveLength(0);

    r.clock.advance(HOUR_MS);
    const res = await r.core.alarm();
    expect(res.rulesRun).toBe(1);
    const alerts = (await r.core.listAlerts(ctx, {}, {})).items;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({automationId: hourly.id, rid: P1});
    expect(ws.messages<WsMsg>().some(m => m.type === 'alert')).toBe(true);
    const a = await r.core.getAutomation(ctx, hourly.id);
    expect(a.nextRunAt).toBe(new Date(t0 + 3 * HOUR_MS).toISOString());
    expect(a.lastFiredAt).not.toBeNull();
  });

  it('stops alarms while the workspace is inactive', async () => {
    const r = makeRoom();
    await r.core.overview(ctx, {range: '24h'});
    expect(r.storage.alarm).not.toBeNull();
    await r.core.closeStreams(TEST_TID, STREAM_CLOSE_EXPIRED);
    expect(r.storage.alarm).toBeNull();
    // A person using the workspace again (e.g. trial extended) resumes them.
    await r.core.overview(ctx, {range: '24h'});
    expect(r.storage.alarm).not.toBeNull();
  });
});

describe('automations', () => {
  let r: TestRoom;
  beforeEach(async () => {
    r = makeRoom();
    r.objects.put(S1, {risk: 55});
    await r.core.overview(ctx, {range: '24h'});
  });

  it('allows at most three scheduled rules', async () => {
    await r.core.createAutomation(ctx, scheduleDef(2));
    await r.core.createAutomation(ctx, scheduleDef(3));
    expect(await codeOf(r.core.createAutomation(ctx, scheduleDef(4)))).toBe(
      'VALIDATION_FAILED',
    );
    const threshold = await r.core.getAutomation(ctx, 'auto-high-risk');
    expect(
      await codeOf(
        r.core.putAutomation(
          ctx,
          threshold.id,
          scheduleDef(5),
          threshold.version,
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    // Changing an existing scheduled rule does not count itself.
    const seeded = await r.core.getAutomation(ctx, 'auto-low-stock');
    const put = await r.core.putAutomation(ctx, seeded.id, scheduleDef(12), 1);
    expect(put.version).toBe(2);
  });

  it('requires intervals of at least one hour and known object types', async () => {
    expect(await codeOf(r.core.createAutomation(ctx, scheduleDef(0)))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      await codeOf(
        r.core.createAutomation(ctx, {...scheduleDef(1), objectType: 'Nope'}),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('uses the version as If-Match', async () => {
    const a = await r.core.getAutomation(ctx, 'auto-high-risk');
    const def: AutomationDef = {
      name: a.name,
      trigger: 'threshold',
      objectType: 'Supplier',
      condition: {op: 'gte', prop: 'risk', value: 50},
      severity: 'CRITICAL',
      cooldownSec: 0,
      enabled: true,
    };
    expect(await codeOf(r.core.putAutomation(ctx, a.id, def, 7))).toBe(
      'PRECONDITION_FAILED',
    );
    const updated = await r.core.putAutomation(ctx, a.id, def, 1);
    expect(updated.version).toBe(2);
    // The changed rule is re-evaluated at once.
    const open = (await r.core.listAlerts(ctx, {status: 'OPEN'}, {})).items;
    expect(open).toHaveLength(1);
    expect(open[0].severity).toBe('CRITICAL');

    expect(await codeOf(r.core.deleteAutomation(ctx, a.id, 1))).toBe(
      'PRECONDITION_FAILED',
    );
    await r.core.deleteAutomation(ctx, a.id, 2);
    expect(await codeOf(r.core.getAutomation(ctx, a.id))).toBe('NOT_FOUND');
    // History is kept, the active alert is closed.
    const all = (await r.core.listAlerts(ctx, {}, {})).items;
    expect(all.map(x => x.status)).toEqual(['CLOSED']);
  });

  it('evaluates a new threshold rule over the cached objects', async () => {
    const created = await r.core.createAutomation(ctx, {
      name: 'Medium risk',
      trigger: 'threshold',
      objectType: 'Supplier',
      condition: {op: 'gte', prop: 'risk', value: 50},
      severity: 'MEDIUM',
      cooldownSec: 60,
      enabled: true,
    });
    expect(created).toMatchObject({version: 1, nextRunAt: null});
    const list = (await r.core.listAlerts(ctx, {}, {})).items;
    expect(list.map(a => a.automationId)).toEqual([created.id]);
  });
});

describe('alerts', () => {
  let r: TestRoom;
  beforeEach(async () => {
    r = makeRoom();
    for (let i = 1; i <= 5; i++) {
      r.objects.put(`ri.Supplier.A${i}`, {risk: 80 + i});
    }
    await r.core.overview(ctx, {range: '24h'});
    await r.core.createAutomation(ctx, {
      name: 'Critical',
      trigger: 'threshold',
      objectType: 'Supplier',
      condition: {op: 'gte', prop: 'risk', value: 85},
      severity: 'CRITICAL',
      cooldownSec: 0,
      enabled: true,
    });
  });

  it('pages newest first and filters', async () => {
    const first = await r.core.listAlerts(ctx, {}, {limit: 4});
    expect(first.items).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();
    const second = await r.core.listAlerts(
      ctx,
      {},
      {limit: 4, cursor: first.nextCursor!},
    );
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map(a => a.id);
    expect(new Set(ids).size).toBe(6);
    expect(
      (await r.core.listAlerts(ctx, {severity: 'CRITICAL'}, {})).items,
    ).toHaveLength(1);
    expect(
      (await r.core.listAlerts(ctx, {rid: 'ri.Supplier.A5' as never}, {}))
        .items,
    ).toHaveLength(2);
    expect(await codeOf(r.core.listAlerts(ctx, {}, {cursor: '!!'}))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('lists the most severe first in the overview', async () => {
    const o = await r.core.overview(ctx, {range: '24h'});
    expect(o.alerts).toHaveLength(6);
    expect(o.alerts[0].severity).toBe('CRITICAL');
  });

  it('acknowledges OPEN alerts', async () => {
    const [a] = (await r.core.listAlerts(ctx, {severity: 'CRITICAL'}, {}))
      .items;
    const ws = await connect(r);
    const acked = await r.core.acknowledgeAlert(ctx, a.id);
    expect(acked).toMatchObject({status: 'ACKED'});
    expect(acked.ackedAt).not.toBeNull();
    expect((await r.core.acknowledgeAlert(ctx, a.id)).status).toBe('ACKED');
    expect(ws.messages<WsMsg>().filter(m => m.type === 'alert')).toHaveLength(
      1,
    );
    expect(await codeOf(r.core.acknowledgeAlert(ctx, 'missing'))).toBe(
      'NOT_FOUND',
    );

    r.objects.put('ri.Supplier.A1', {risk: 0});
    await r.core.applyEvents(TEST_TID, [event([['ri.Supplier.A1', ['risk']]])]);
    const [closed] = (
      await r.core.listAlerts(ctx, {rid: 'ri.Supplier.A1' as never}, {})
    ).items;
    expect(closed.status).toBe('CLOSED');
    expect(await codeOf(r.core.acknowledgeAlert(ctx, closed.id))).toBe(
      'CONFLICT',
    );
  });
});

describe('stream tickets', () => {
  let r: TestRoom;
  beforeEach(() => {
    r = makeRoom();
  });

  it('issues single-use tickets and stores only their hash', async () => {
    const {ticket, expiresIn} = await r.core.issueStreamTicket(ctx);
    expect(expiresIn).toBe(30);
    expect(ticket.startsWith(`${TEST_TID}.`)).toBe(true);
    const rows = r.sql
      .exec<Record<string, unknown>>('SELECT * FROM stream_ticket')
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].ticket_hash).toBe(await sha256Hex(ticket));
    expect(JSON.stringify(rows)).not.toContain(ticket.split('.')[1]);

    expect(await r.core.redeemTicket(ticket)).toEqual({
      sub: ctx.sub,
      actingAs: false,
    });
    expect(await r.core.redeemTicket(ticket)).toBeNull();
  });

  it('expires tickets after 30 seconds', async () => {
    const {ticket} = await r.core.issueStreamTicket(ctx);
    r.clock.advance(30_000);
    expect(await r.core.redeemTicket(ticket)).toBeNull();
  });

  it('binds the Act-as flag and rejects foreign or malformed tickets', async () => {
    const admin = testCtx({
      role: 'admin',
      actingAs: true,
      sub: '01K6A000000000000000000A01',
    });
    const {ticket} = await r.core.issueStreamTicket(admin);
    expect(await r.core.redeemTicket(ticket)).toEqual({
      sub: '01K6A000000000000000000A01',
      actingAs: true,
    });
    const foreign = ticket.replace(TEST_TID, '01K6A000000000000000000T99');
    expect(await r.core.redeemTicket(foreign)).toBeNull();
    expect(await r.core.redeemTicket('garbage')).toBeNull();
    expect(await r.core.redeemTicket(null)).toBeNull();
  });
});

describe('connections', () => {
  let r: TestRoom;
  beforeEach(async () => {
    r = makeRoom();
    r.objects.put(S1, {risk: 10});
    await r.core.overview(ctx, {range: '24h'});
  });

  it('sends a snapshot on connect', async () => {
    const ws = await connect(r);
    const [snap] = ws.messages<WsMsg>();
    expect(snap.type).toBe('snapshot');
    expect(snap.seq).toBe(0);
    expect((snap.data as SituationOverview).initialized).toBe(true);
  });

  it('keeps at most three connections per user (oldest closed)', async () => {
    const a = await connect(r);
    const b = await connect(r);
    const c = await connect(r);
    const other = await connect(r, '01K6A000000000000000000U02');
    const d = await connect(r);
    expect(a.closed).toEqual({
      code: STREAM_CLOSE_REPLACED,
      reason: 'connection limit',
    });
    expect([b, c, d, other].every(s => s.closed === null)).toBe(true);
    expect(r.hub.list(ctx.sub)).toHaveLength(3);
  });

  it('replays a buffered gap on resume, else sends a snapshot', async () => {
    for (let i = 0; i < 5; i++) r.core.rt.push('trial', {i});
    const ws = await connect(r);
    await r.core.message(ws, JSON.stringify({type: 'resume', lastSeq: 2}));
    expect(
      ws
        .messages<WsMsg>()
        .slice(1)
        .map(m => m.seq),
    ).toEqual([3, 4, 5]);

    await r.core.message(ws, JSON.stringify({type: 'resume', lastSeq: 5}));
    expect(ws.sent).toHaveLength(4);

    for (let i = 0; i < 250; i++) r.core.rt.push('trial', {i});
    const ws2 = await connect(r);
    await r.core.message(ws2, JSON.stringify({type: 'resume', lastSeq: 2}));
    const msgs = ws2.messages<WsMsg>();
    expect(msgs.map(m => m.type)).toEqual(['snapshot', 'snapshot']);
    expect(msgs[1].seq).toBe(255);
    // The buffer keeps the latest 200 messages.
    expect(r.store.wsBounds()).toEqual({minSeq: 56, maxSeq: 255});
    await r.core.message(ws2, JSON.stringify({type: 'resume', lastSeq: 100}));
    expect(ws2.messages<WsMsg>().slice(2)).toHaveLength(155);
    await r.core.message(ws2, 'not json');
  });

  it('pushes recommendations and shows their impacted objects', async () => {
    const ws = await connect(r);
    await r.core.pushRecommendation(ctx, {
      id: 'rec-1',
      status: 'Proposed',
      summary: 'Switch supplier',
      confidence: 0.8,
      rankedBy: 'rules',
      focus: S1 as never,
      expectedImpact: 0.3,
      createdAt: '2026-09-24T10:00:00Z',
      expiresAt: '2026-09-25T10:00:00Z',
      impacted: [
        {rid: S1 as never, type: 'Supplier', title: 'A', delta: 0.1, hop: 0},
        {rid: S2 as never, type: 'Supplier', title: 'B', delta: -0.5, hop: 1},
      ],
    });
    const last = ws.messages<WsMsg>().pop()!;
    expect(last.type).toBe('recommendation');
    const o = await r.core.overview(ctx, {range: '24h'});
    expect(o.impacted.map(i => i.rid)).toEqual([S2, S1]);
  });

  it('closeStreams closes every connection with the given code', async () => {
    const a = await connect(r);
    const b = await connect(r, '01K6A000000000000000000U02');
    await r.core.closeStreams(TEST_TID, STREAM_CLOSE_EXPIRED);
    expect(a.closed?.code).toBe(4401);
    expect(b.closed?.code).toBe(4401);
  });
});

describe('tenant lifecycle', () => {
  it('exports situation.json with alert history, automations and KPI defs', async () => {
    const r = makeRoom();
    r.objects.put(S1, {risk: 99});
    await r.core.overview(ctx, {range: '24h'});
    const doc = JSON.parse(await r.core.exportTenant(TEST_TID));
    expect(doc.automations).toHaveLength(2);
    expect(doc.kpis).toHaveLength(4);
    expect(doc.alerts).toHaveLength(1);
    expect(doc.alerts[0]).toMatchObject({rid: S1, status: 'OPEN'});
  });

  it('purges everything and keeps only a 48-hour tombstone', async () => {
    const r = makeRoom();
    r.objects.put(S1, {risk: 99});
    await r.core.overview(ctx, {range: '24h'});
    const ws = await connect(r);
    const before = await r.core.countTenant(TEST_TID);
    expect(before).toBeGreaterThan(0);

    const res = await r.core.purgeTenant(TEST_TID);
    expect(res).toEqual({deleted: before, done: true});
    expect(ws.closed?.code).toBe(STREAM_CLOSE_EXPIRED);
    expect(tables(r.sql)).toEqual(['room_meta']);
    expect(r.sql.exec('SELECT k FROM room_meta').toArray()).toEqual([
      {k: 'tombstone_until'},
    ]);
    const until = r.clock.now().getTime() + 48 * HOUR_MS;
    expect(r.storage.alarm).toBe(until);
    expect(await r.core.countTenant(TEST_TID)).toBe(0);
    expect(await r.core.purgeTenant(TEST_TID)).toEqual({
      deleted: 0,
      done: true,
    });

    // Late events are dropped without touching object-graph.
    const calls = r.objects.calls.getObjects;
    expect(
      await r.core.applyEvents(TEST_TID, [event([[S1, ['risk']]])]),
    ).toMatchObject({dropped: true});
    expect(r.objects.calls.getObjects).toBe(calls);
    expect(await codeOf(r.core.overview(ctx, {range: '24h'}))).toBe(
      'NOT_FOUND',
    );
    expect(
      await r.core.redeemTicket(`${TEST_TID}.abcdefghijklmnopqrstuvwx`),
    ).toBeNull();

    // A restarted instance stays tombstoned (no schema is recreated).
    r.restart();
    expect(tables(r.sql)).toEqual(['room_meta']);
    expect(JSON.parse(await r.core.exportTenant(TEST_TID))).toEqual({
      automations: [],
      kpis: [],
      alerts: [],
    });

    // An early alarm re-arms; the final one deletes the tombstone.
    r.clock.advance(HOUR_MS);
    expect((await r.core.alarm()).kind).toBe('tombstone');
    expect(r.storage.alarm).toBe(until);
    r.clock.advance(48 * HOUR_MS);
    expect((await r.core.alarm()).kind).toBe('deleted');
    expect(tables(r.sql)).toEqual([]);
    expect(r.storage.alarm).toBeNull();
  });
});

describe('schema migration', () => {
  it('drops V1.3 tables on first start', () => {
    const sql = new MemorySqlStorage();
    sql.exec('CREATE TABLE kpi (id TEXT PRIMARY KEY, value REAL)');
    sql.exec('CREATE TABLE open_alert (k TEXT PRIMARY KEY)');
    sql.exec('CREATE TABLE outbox_ws (seq INTEGER PRIMARY KEY, frame TEXT)');
    sql.exec(
      'CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)',
    );
    const r = makeRoom({sql});
    const t = tables(sql);
    expect(t).not.toContain('kpi');
    expect(t).not.toContain('open_alert');
    expect(t).not.toContain('meta');
    expect(t).toEqual(
      expect.arrayContaining([
        'alert',
        'automation',
        'outbox_ws',
        'object_cache',
      ]),
    );
    expect(r.store.getMeta('schema_version')).toBe(ROOM_SCHEMA_VERSION);
    // A second start keeps the data.
    r.store.setMeta('tid', TEST_TID);
    r.restart();
    expect(r.store.getMeta('tid')).toBe(TEST_TID);
  });
});
