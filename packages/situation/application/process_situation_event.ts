/**
 * @fileoverview domain-events handling inside a room (详细设计 6.11.4 事件处理):
 * tombstone → drop; dedupe by eventId; read current values by rid; update
 * the object cache and KPIs; evaluate the threshold rules whose properties
 * changed; push realtime messages.
 */

import {DAY_MS, type DomainEventMsg, type Rid} from '@ontodecide/shared-kernel';
import type {ObjectDto} from '@ontodecide/object-graph/contract';
import {ensureInitialized, roomCtx, toView} from './install_pack_content';
import {KpiTracker, markMetricsDirty} from './kpi_handlers';
import type {AlertRecord, ApplyEventsResult} from './ports';
import type {RoomRuntime} from './support';

/** Seen-event retention (dedupe window). */
export const SEEN_EVENT_TTL_MS = DAY_MS;

/** Largest rid batch per getObjects call. */
export const GET_OBJECTS_CHUNK = 100;

interface PendingChange {
  type: string;
  changed: Set<string>;
}

function collect(
  events: readonly DomainEventMsg[],
): Map<string, PendingChange> {
  const out = new Map<string, PendingChange>();
  for (const e of events) {
    for (const c of e.changes ?? []) {
      const p = out.get(c.rid);
      if (p) for (const f of c.changed ?? []) p.changed.add(f);
      else out.set(c.rid, {type: c.type, changed: new Set(c.changed ?? [])});
    }
  }
  return out;
}

/** Applies a group of domain events of the room's workspace. */
export async function applyEvents(
  rt: RoomRuntime,
  tid: string,
  events: readonly DomainEventMsg[],
): Promise<ApplyEventsResult> {
  if (rt.tombstoned())
    return {applied: 0, duplicates: events.length, dropped: true};
  rt.bindTid(tid);
  const {store} = rt.deps;
  const unseen = (list: readonly DomainEventMsg[]): DomainEventMsg[] => {
    const ids = new Set<string>();
    return list.filter(e => {
      if (ids.has(e.eventId) || store.isSeen(e.eventId)) return false;
      ids.add(e.eventId);
      return true;
    });
  };
  const fresh = unseen(events);
  const duplicates = events.length - fresh.length;
  if (!fresh.length) return {applied: 0, duplicates, dropped: false};

  if (!rt.initialized()) {
    // The first initialization reads the current state of every object,
    // which already includes these changes.
    await ensureInitialized(rt);
    if (rt.tombstoned()) return {applied: 0, duplicates, dropped: true};
    const now = rt.now();
    for (const e of unseen(fresh)) store.markSeen(e.eventId, now);
    return {applied: fresh.length, duplicates, dropped: false};
  }

  const pending = collect(fresh);
  const rids = [...pending.keys()] as Rid[];
  const current = new Map<string, ObjectDto>();
  for (let i = 0; i < rids.length; i += GET_OBJECTS_CHUNK) {
    const chunk = rids.slice(i, i + GET_OBJECTS_CHUNK);
    for (const o of await rt.deps.objects.getObjects(roomCtx(tid), chunk)) {
      current.set(o.rid, o);
    }
  }

  // Synchronous from here on: atomic within the room.
  if (rt.tombstoned()) return {applied: 0, duplicates, dropped: true};
  const todo = unseen(fresh);
  const now = rt.now();
  const kpis = new KpiTracker(store);
  const alerts: AlertRecord[] = [];
  const {index, byId} = rt.ruleIndex();
  for (const [rid, change] of collect(todo)) {
    const before = store.getObject(rid);
    const dto = current.get(rid);
    const after = dto ? toView(dto) : null;
    if (after) store.putObject(after);
    else if (before) store.deleteObject(rid);
    kpis.apply(before, after);
    if (!after) {
      rt.closeAlertsOf(rid, alerts);
      continue;
    }
    const whole = before === null || before.type !== after.type;
    for (const r of index.candidates(after.type, [...change.changed], whole)) {
      const rule = byId.get(r.id);
      if (rule) rt.evaluate(rule, rid, after, alerts);
    }
  }
  for (const e of todo) store.markSeen(e.eventId, now);
  store.pruneSeen(now - SEEN_EVENT_TTL_MS);

  const changedKpis = kpis.commit(now);
  if (changedKpis.length) {
    markMetricsDirty(rt);
    rt.push(
      'kpi',
      changedKpis.map(k => rt.kpiValue(k)),
    );
  }
  rt.pushAlerts(alerts);
  if (changedKpis.length) await rt.reschedule();
  return {
    applied: todo.length,
    duplicates: events.length - todo.length,
    dropped: false,
  };
}
