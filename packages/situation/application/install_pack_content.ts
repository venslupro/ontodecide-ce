/**
 * @fileoverview First initialization of a room (详细设计 6.11.4): installs
 * the template's KPIs and sample automations and computes the KPI snapshot
 * from the current objects (ObjectGraphRpc.listObjects, ≤ 3 pages).
 */

import {AppError, type CallCtx, serviceCtx} from '@ontodecide/shared-kernel';
import type {ObjectDto} from '@ontodecide/object-graph/contract';
import type {TemplateSeeds} from '@ontodecide/ontology/contract';
import {
  type KpiDefinition,
  type ObjectView,
  firstRunAt,
  validateAutomation,
} from '../domain';
import {SITUATION_SERVICE} from './deps';
import {flushMetrics, recomputeKpi} from './kpi_handlers';
import type {AlertRecord, AutomationRecord} from './ports';
import {META, type RoomRuntime} from './support';

/** Pages of objects read during initialization (100 each). */
export const INIT_MAX_PAGES = 3;

/** Converts an object DTO to the cached view. */
export function toView(o: ObjectDto): ObjectView {
  return {rid: o.rid, type: o.type, title: o.title, props: o.props};
}

/** Context of calls the room makes on its own behalf. */
export function roomCtx(tid: string): CallCtx {
  return serviceCtx(tid, SITUATION_SERVICE);
}

/**
 * Initializes the room once. Concurrent callers share the same attempt; a
 * failed attempt leaves the room uninitialized so the next call retries.
 */
export async function ensureInitialized(rt: RoomRuntime): Promise<void> {
  if (rt.initialized()) return;
  if (!rt.initializing) {
    rt.initializing = initialize(rt).finally(() => {
      rt.initializing = null;
    });
  }
  return rt.initializing;
}

/**
 * Resets the room after the workspace ontology template changes. Clears the
 * previously installed KPIs and automations (they belong to the old template),
 * drops the initialized flag and re-runs initialization so the new template's
 * seeds take effect. This keeps the system decoupled from any specific
 * scenario: switching templates simply reloads the new template's KPI and
 * automation seeds.
 */
export async function resetForTemplate(
  rt: RoomRuntime,
  ctx: CallCtx,
): Promise<void> {
  rt.touch(ctx);
  const store = rt.deps.store;
  for (const k of store.listKpis()) store.deleteKpi(k.id);
  for (const a of store.listAutomations()) store.deleteAutomation(a.id);
  store.deleteMeta(META.initialized);
  rt.reset();
  rt.rulesChanged();
  await ensureInitialized(rt);
}

async function initialize(rt: RoomRuntime): Promise<void> {
  const tid = rt.tid();
  if (!tid) throw new AppError('INTERNAL', 'Room is not bound to a workspace');
  const {ontology, objects} = rt.deps;
  const ctx = roomCtx(tid);
  const schema = await ontology.getCompiledSchema(ctx);
  const seeds = await ontology.getTemplateSeeds(schema.templateId);
  const found: ObjectDto[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < INIT_MAX_PAGES; page++) {
    const res = await objects.listObjects(ctx, {}, {limit: 100, cursor});
    found.push(...res.items);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  // Synchronous from here on: atomic within the room.
  if (rt.tombstoned() || rt.initialized()) return;
  install(rt, seeds, found);
  await rt.reschedule();
}

function install(
  rt: RoomRuntime,
  seeds: TemplateSeeds,
  found: ObjectDto[],
): void {
  const {store, logger} = rt.deps;
  const now = rt.now();
  for (const o of found) store.putObject(toView(o));

  seeds.kpis.forEach((s, i) => {
    const def: KpiDefinition = {
      id: s.id,
      name: s.name,
      objectType: s.objectType,
      aggregate: s.aggregate,
      ...(s.filter ? {filter: s.filter} : {}),
      unit: s.unit ?? null,
      target: s.target ?? null,
      higherIsBetter: s.higherIsBetter ?? true,
    };
    const state = recomputeKpi(store, {
      ...def,
      state: {cnt: 0, total: 0, value: null},
      updatedAt: null,
    });
    store.insertKpi(def, state, now, i);
  });

  for (const s of seeds.automations) {
    if (store.getAutomation(s.id)) continue;
    try {
      const def = validateAutomation(
        {
          name: s.name,
          trigger: s.trigger,
          objectType: s.objectType,
          condition: s.condition,
          ...(s.everyHours !== undefined ? {everyHours: s.everyHours} : {}),
          severity: s.severity,
          cooldownSec: s.cooldownSec,
          enabled: s.enabled,
        },
        store.countScheduled(),
      );
      const rec: AutomationRecord = {
        ...def,
        id: s.id,
        version: 1,
        nextRunAt:
          def.trigger === 'schedule' && def.everyHours
            ? firstRunAt(now, def.everyHours)
            : null,
        lastFiredAt: null,
        createdAt: now,
      };
      store.insertAutomation(rec);
    } catch (e) {
      logger.warn('situation.seed_skipped', {
        automationId: s.id,
        code: AppError.from(e).code,
      });
    }
  }
  rt.rulesChanged();

  flushMetrics(rt, now);
  // Evaluate the threshold rules once over the whole snapshot.
  const {index, byId} = rt.ruleIndex();
  const raised: AlertRecord[] = [];
  for (const o of store.listObjects()) {
    for (const r of index.forType(o.type)) {
      const rule = byId.get(r.id);
      if (rule) rt.evaluate(rule, o.rid, o, raised);
    }
  }
  store.setMeta(META.initialized, String(now));
  logger.info('situation.initialized', {
    kpis: seeds.kpis.length,
    automations: byId.size,
    objects: found.length,
    alerts: raised.length,
  });
}
