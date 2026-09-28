/**
 * @fileoverview TenantLifecycle of situation-awareness: delegates to the
 * workspace's room. The export is one `situation.json` page; purge deletes
 * the whole room at once and leaves only its tombstone.
 */

import type {TenantLifecycleRpc} from '@ontodecide/shared-kernel';
import type {SituationRoomApi} from '../application';
import type {RoomResolver} from './rpc';

/** Builds the lifecycle entry point. */
export function createSituationLifecycle(
  rooms: RoomResolver<
    Pick<
      SituationRoomApi,
      'exportTenant' | 'purgeTenant' | 'countTenant' | 'closeStreams'
    >
  >,
): Required<Omit<TenantLifecycleRpc, 'tenantStats'>> {
  return {
    async exportTenant(tid, _cursor) {
      const text = await rooms(tid).exportTenant(tid);
      return {file: 'situation.json', text, nextCursor: null};
    },
    purgeTenant: (tid, _maxRows) => rooms(tid).purgeTenant(tid),
    countTenant: tid => rooms(tid).countTenant(tid),
    closeStreams: (tid, code) => rooms(tid).closeStreams(tid, code),
  };
}
