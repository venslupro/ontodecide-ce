/**
 * @fileoverview Wiring test of the situation-awareness service module: RPC,
 * queue, cron and the WebSocket stream forwarding.
 */

import type {
  ObjectGraphRpc,
  SituationEventMsg,
} from '@ontodecide/object-graph/contract';
import {
  AppError,
  CTX_HEADER,
  FixedClock,
  type Rid,
  encodeCtx,
  silentLogger,
} from '@ontodecide/shared-kernel';
import type {DecisionJobMsg} from '@ontodecide/situation/contract';
import {
  SituationRoomCore,
  UsageGuardCore,
} from '@ontodecide/situation/infrastructure';
import {describe, expect, it} from 'vitest';
import {
  FakeDoNamespace,
  MemorySqlStorage,
  QueueBus,
  createTestD1,
  rpcBinding,
  testCtx,
} from '@ontodecide/testing';
import type {Env} from './env';
import {createService} from './service';

const S1 = 'ri.t1.Supplier.S1' as Rid;

function setup() {
  const clock = new FixedClock('2026-09-24T10:00:00Z');
  const bus = new QueueBus();
  const rooms = new FakeDoNamespace(
    () => new SituationRoomCore(new MemorySqlStorage(), undefined, clock),
  );
  const forwarded: {tenant: string; url: string}[] = [];
  // Request objects cannot be structured-cloned, so `fetch` is served here.
  const roomNs = {
    idFromName: (n: string) => rooms.idFromName(n),
    get: (id: DurableObjectId) =>
      new Proxy(rooms.get(id), {
        get(target, prop) {
          if (prop === 'fetch') {
            return async (req: Request) => {
              forwarded.push({tenant: String(id), url: req.url});
              return new Response('room', {status: 200});
            };
          }
          return (target as unknown as Record<string | symbol, unknown>)[prop];
        },
      }),
  } as unknown as DurableObjectNamespace;
  const usage = new FakeDoNamespace(
    () => new UsageGuardCore(new MemorySqlStorage(), {clock}),
  );
  const objects = {
    aggregate: async () => 1,
    evaluateObjectSet: async () => ({items: [], nextCursor: null}),
    applyAction: async () => {
      throw new Error('unused');
    },
  };
  const env: Env = {
    SITUATION_DB: createTestD1('situation'),
    SITUATION_ROOM: roomNs,
    USAGE_GUARD: usage.asNamespace(),
    OBJECTS: rpcBinding(objects) as unknown as ObjectGraphRpc,
    DECISION_JOBS_QUEUE: bus.sender<DecisionJobMsg>('decision-jobs'),
    INGEST_QUEUE: bus.sender('ingest'),
    OBJECT_WRITES_QUEUE: bus.sender('object-writes'),
    GRAPH_SYNC_QUEUE: bus.sender('graph-sync'),
    SITUATION_EVENTS_QUEUE: bus.sender('situation-events'),
  };
  const svc = createService(env, {clock, logger: silentLogger});
  return {svc, bus, rooms, forwarded, clock};
}

describe('situation-awareness service', () => {
  it('forwards the stream to the tenant room with x-od-ctx', async () => {
    const {svc, forwarded} = setup();
    const url = 'https://sit/api/v1/situation/stream?lastSeq=3';
    const res = await svc.fetch!(
      new Request(url, {
        headers: {[CTX_HEADER]: encodeCtx(testCtx({role: 'Viewer'}))},
      }),
    );
    expect(res.status).toBe(200);
    expect(forwarded).toEqual([{tenant: 't1', url}]);

    const missing = await svc.fetch!(new Request(url));
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({code: 'AUTH_INVALID'});
    const other = await svc.fetch!(new Request('https://sit/other'));
    expect(other.status).toBe(404);
  });

  it('wires queue, rpc and cron end to end', async () => {
    const {svc, bus, rooms} = setup();
    const rpc = rpcBinding(svc.rpc);
    const ctx = testCtx();
    await rpc.installPackContent(ctx, {
      automations: [
        {
          name: 'Supplier risk high',
          trigger: {kind: 'threshold', objectType: 'Supplier'},
          condition: {op: 'gte', prop: 'riskScore', value: 70},
          effects: [
            {kind: 'alert'},
            {
              kind: 'recommend',
              perturbation: {property: 'capacity', change: -0.6},
            },
          ],
          severity: 'HIGH',
        },
      ],
      kpis: [
        {
          name: 'Suppliers',
          objectSet: {objectType: 'Supplier'},
          aggregate: {fn: 'count'},
        },
      ],
    });
    const msg: SituationEventMsg = {
      eventId: 'e1',
      tenantId: 't1',
      kind: 'ObjectsUpserted',
      occurredAt: '2026-09-24T10:00:00.000Z',
      correlationId: 'c1',
      changes: [
        {
          rid: S1,
          type: 'Supplier',
          title: 'Acme',
          changed: ['riskScore'],
          after: {riskScore: 82},
        },
      ],
    };
    await bus.sender('situation-events').send(msg);
    await bus.drain({
      'situation-events': {handler: b => svc.queue!(b)},
    });
    expect(await rpc.listAlerts(ctx)).toHaveLength(1);
    expect(bus.size('decision-jobs')).toBe(1);

    const snap = await rooms.instance('t1').snapshot();
    expect(snap.data).toMatchObject({
      kpis: [{value: 1}],
      alerts: [{rid: S1, severity: 'HIGH'}],
    });

    await svc.scheduled!('0 * * * *', new Date('2026-09-24T11:00:00Z'));
    try {
      await rpc.saveKpi(testCtx({role: 'Viewer'}), {
        name: 'x',
        objectSet: {objectType: 'Supplier'},
        aggregate: {fn: 'count'},
      });
      throw new Error('expected FORBIDDEN');
    } catch (e) {
      expect(AppError.from(e).code).toBe('FORBIDDEN');
    }
  });
});
