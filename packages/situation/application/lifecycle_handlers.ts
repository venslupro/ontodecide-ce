/**
 * @fileoverview TenantLifecycle inside the room: export `situation.json`,
 * purge (deleteAll + tombstone with a 48 h alarm) and count.
 */

import {
  HOUR_MS,
  LIFECYCLE,
  type PurgeResult,
  STREAM_CLOSE_EXPIRED,
} from '@ontodecide/shared-kernel';
import type {RoomRuntime} from './support';
import {toAlertDto, toAutomationDto} from './support';

/** The `situation.json` document. */
export function exportDocument(rt: RoomRuntime): string {
  const store = rt.deps.store;
  if (rt.tombstoned() || rt.tid() === null) {
    return JSON.stringify({automations: [], kpis: [], alerts: []});
  }
  return JSON.stringify({
    automations: store.listAutomations().map(toAutomationDto),
    kpis: store.listKpis().map(k => ({
      id: k.id,
      name: k.name,
      objectType: k.objectType,
      aggregate: k.aggregate,
      ...(k.filter ? {filter: k.filter} : {}),
      unit: k.unit,
      target: k.target,
      higherIsBetter: k.higherIsBetter,
      value: k.state.value,
    })),
    alerts: store.allAlerts().map(toAlertDto),
  });
}

/**
 * Deletes everything (storage.deleteAll + deleteAlarm), then writes only
 * the tombstone key and an alarm that deletes it after 48 h.
 */
export async function purgeRoom(rt: RoomRuntime): Promise<PurgeResult> {
  const {store, storage, sockets, logger} = rt.deps;
  if (rt.tombstoned()) return {deleted: 0, done: true};
  const deleted = store.countRows();
  for (const s of sockets.list()) {
    try {
      s.close(STREAM_CLOSE_EXPIRED, 'workspace removed');
    } catch {
      // Already closed.
    }
  }
  await storage.deleteAlarm();
  await storage.deleteAll();
  rt.reset();
  const until = rt.now() + LIFECYCLE.tombstoneHours * HOUR_MS;
  store.writeTombstone(until);
  await storage.setAlarm(until);
  logger.info('situation.purged', {deleted});
  return {deleted, done: true};
}
