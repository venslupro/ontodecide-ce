/**
 * @fileoverview TenantLifecycle entry point of object-graph (bound only to
 * identity-access). Builds its SystemRepository-backed store on demand.
 */

import type {Clock, TenantLifecycleRpc} from '@ontodecide/shared-kernel';
import {createTenantLifecycle} from '../application';
import type {LifecycleStore} from '../application';

/** Builds the TenantLifecycle handler object. */
export function createLifecycleRpc(deps: {
  store: () => LifecycleStore;
  clock: Clock;
}): TenantLifecycleRpc {
  const lc = (): TenantLifecycleRpc =>
    createTenantLifecycle({store: deps.store(), clock: deps.clock});
  return {
    exportTenant: (tid, cursor) => lc().exportTenant(tid, cursor),
    purgeTenant: (tid, maxRows) => lc().purgeTenant(tid, maxRows),
    countTenant: tid => lc().countTenant(tid),
    tenantStats: tids => lc().tenantStats!(tids),
  };
}
