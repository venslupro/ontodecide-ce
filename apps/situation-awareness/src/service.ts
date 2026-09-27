/**
 * @fileoverview situation-awareness service module (used by the Worker
 * entry point and the in-process test harness).
 */

import type {
  ServiceModule,
  TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import type {SituationRpc} from '@ontodecide/situation/contract';
import {createContainer, type Overrides} from './container';
import type {Env} from './env';

export type {Overrides, RoomStub} from './container';
export {createRoomCore} from './container';

/** The service with every entry point present. */
export interface SituationService extends ServiceModule<SituationRpc> {
  lifecycle: Required<TenantLifecycleRpc>;
  queue: NonNullable<ServiceModule<SituationRpc>['queue']>;
  fetch: NonNullable<ServiceModule<SituationRpc>['fetch']>;
}

/** Creates the situation-awareness service (RPC, lifecycle, queue, fetch). */
export function createService(
  env: Env,
  overrides: Overrides = {},
): SituationService {
  const c = createContainer(env, overrides);
  return {
    rpc: c.rpc,
    lifecycle: c.lifecycle,
    queue: batch => c.queue(batch),
    fetch: request => c.fetch(request),
  };
}
