/**
 * @fileoverview Test fixtures of the situation context: fake object-graph
 * and ontology-manager (wrapped with rpcBinding), template seeds and a room
 * factory over MemorySqlStorage.
 */

import {
  type CallCtx,
  type DomainEventMsg,
  FixedClock,
  type PageRequest,
  type Rid,
  silentLogger,
} from '@ontodecide/shared-kernel';
import type {
  ObjectDto,
  ObjectPage,
  ObjectQuery,
} from '@ontodecide/object-graph/contract';
import type {
  CompiledSchema,
  TemplateSeeds,
} from '@ontodecide/ontology/contract';
import {MemorySqlStorage, TEST_TID, rpcBinding} from '@ontodecide/testing';
import type {
  ObjectsPort,
  OntologyPort,
  SituationRoomCore,
} from '../application';
import {InMemoryRoomStorage, MemorySocketHub} from './memory_runtime';
import {createSituationRoomCore} from './situation_room_core';
import {SqlRoomStore} from './sql_room_store';

/** Fake object-graph holding objects in memory. */
export class FakeObjects implements ObjectsPort {
  readonly objects = new Map<string, ObjectDto>();
  calls = {getObjects: 0, listObjects: 0};
  /** Error thrown by the next getObjects call. */
  failNext: Error | null = null;

  /** Adds or replaces an object. */
  put(
    rid: string,
    props: Record<string, unknown>,
    type = 'Supplier',
  ): ObjectDto {
    const prev = this.objects.get(rid);
    const o: ObjectDto = {
      rid: rid as Rid,
      type,
      primaryKey: rid,
      title: `T ${rid.split('.').pop()}`,
      props: {...(prev?.props ?? {}), ...props},
      provenance: {},
      version: (prev?.version ?? 0) + 1,
      updatedAt: '2026-09-24T00:00:00.000Z',
    };
    this.objects.set(rid, o);
    return o;
  }

  async getObjects(_ctx: CallCtx, rids: Rid[]): Promise<ObjectDto[]> {
    this.calls.getObjects++;
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    return rids.flatMap(r => {
      const o = this.objects.get(r);
      return o ? [o] : [];
    });
  }

  async listObjects(
    _ctx: CallCtx,
    q: ObjectQuery,
    page: PageRequest,
  ): Promise<ObjectPage> {
    this.calls.listObjects++;
    const all = [...this.objects.values()].filter(
      o => !q.type || o.type === q.type,
    );
    const start = page.cursor ? Number(page.cursor) : 0;
    const limit = page.limit ?? 50;
    const items = all.slice(start, start + limit);
    return {
      items,
      nextCursor: start + limit < all.length ? String(start + limit) : null,
    };
  }
}

/** Template seeds used by the tests. */
export const TEST_SEEDS: TemplateSeeds = {
  kpis: [
    {
      id: 'kpi-suppliers',
      name: {'zh-CN': '供应商', 'en-US': 'Suppliers'},
      objectType: 'Supplier',
      aggregate: {fn: 'count'},
    },
    {
      id: 'kpi-avg-risk',
      name: 'Average risk',
      objectType: 'Supplier',
      aggregate: {fn: 'avg', prop: 'risk'},
      unit: 'pt',
      target: 40,
      higherIsBetter: false,
    },
    {
      id: 'kpi-max-risk',
      name: 'Max risk',
      objectType: 'Supplier',
      aggregate: {fn: 'max', prop: 'risk'},
      higherIsBetter: false,
    },
    {
      id: 'kpi-high-risk',
      name: 'High risk suppliers',
      objectType: 'Supplier',
      aggregate: {fn: 'count'},
      filter: {op: 'gte', prop: 'risk', value: 80},
      higherIsBetter: false,
    },
  ],
  automations: [
    {
      id: 'auto-high-risk',
      name: 'High risk supplier',
      trigger: 'threshold',
      objectType: 'Supplier',
      condition: {op: 'gte', prop: 'risk', value: 80},
      severity: 'HIGH',
      cooldownSec: 600,
      enabled: true,
    },
    {
      id: 'auto-low-stock',
      name: 'Low stock (daily)',
      trigger: 'schedule',
      objectType: 'Part',
      condition: {op: 'lt', prop: 'stock', value: 10},
      everyHours: 24,
      severity: 'MEDIUM',
      cooldownSec: 0,
      enabled: true,
    },
  ],
};

/** Fake ontology-manager. */
export class FakeOntology implements OntologyPort {
  seeds: TemplateSeeds = structuredClone(TEST_SEEDS);
  calls = {getCompiledSchema: 0, getTemplateSeeds: [] as string[]};
  fail: Error | null = null;

  async getCompiledSchema(_ctx: CallCtx): Promise<CompiledSchema> {
    this.calls.getCompiledSchema++;
    if (this.fail) throw this.fail;
    return {
      templateId: 'supply-chain',
      templateVersion: '1',
      custom: false,
      etag: 0,
      objectTypes: {Supplier: {}, Part: {}},
      linkTypes: {},
      actionTypes: {},
      functions: {},
      simulationKpis: [],
      indexPlan: [],
    } as unknown as CompiledSchema;
  }

  async getTemplateSeeds(templateId: string): Promise<TemplateSeeds> {
    this.calls.getTemplateSeeds.push(templateId);
    return this.seeds;
  }
}

/** A room under test and its fakes. */
export interface TestRoom {
  core: SituationRoomCore;
  sql: MemorySqlStorage;
  store: SqlRoomStore;
  storage: InMemoryRoomStorage;
  hub: MemorySocketHub;
  objects: FakeObjects;
  ontology: FakeOntology;
  clock: FixedClock;
  /** Rebuilds the core over the same storage (DO eviction / restart). */
  restart(): SituationRoomCore;
}

/** Creates a room over MemorySqlStorage. */
export function makeRoom(
  opts: {sql?: MemorySqlStorage; clock?: FixedClock} = {},
): TestRoom {
  const sql = opts.sql ?? new MemorySqlStorage();
  const storage = new InMemoryRoomStorage(sql);
  const hub = new MemorySocketHub();
  const objects = new FakeObjects();
  const ontology = new FakeOntology();
  const clock = opts.clock ?? new FixedClock('2026-09-24T10:00:00Z');
  const build = () =>
    createSituationRoomCore({
      sql,
      storage,
      sockets: hub,
      objects: rpcBinding(objects),
      ontology: rpcBinding(ontology),
      clock,
      logger: silentLogger,
    });
  const room: TestRoom = {
    core: build(),
    sql,
    store: new SqlRoomStore(sql),
    storage,
    hub,
    objects,
    ontology,
    clock,
    restart: () => (room.core = build()),
  };
  return room;
}

let eventSeq = 0;

/** Builds a domain event. */
export function event(
  changes: [rid: string, changed: string[], type?: string][],
  opts: {eventId?: string; tid?: string} = {},
): DomainEventMsg {
  return {
    eventId: opts.eventId ?? `evt-${++eventSeq}`,
    tid: opts.tid ?? TEST_TID,
    occurredAt: Date.now(),
    kind: 'ObjectsUpserted',
    changes: changes.map(([rid, changed, type]) => ({
      rid: rid as Rid,
      type: type ?? 'Supplier',
      changed,
    })),
  };
}
