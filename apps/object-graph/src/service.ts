/**
 * @fileoverview Service module of object-graph (used by the Worker entry
 * point and the in-process test harness): RPC, TenantLifecycle and the
 * outbox cron. object-graph consumes no queue.
 */

import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {
  ServiceModule,
  TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import {createContainer} from './container';
import type {Overrides} from './container';
import type {Env} from './env';

export type {Overrides} from './container';

/** Builds the object-graph service. */
export function createService(
  env: Env,
  overrides: Overrides = {},
): ServiceModule<ObjectGraphRpc> & {
  lifecycle: TenantLifecycleRpc;
  scheduled(cron: string, now: Date): Promise<void>;
} {
  const c = createContainer(env, overrides);
  return {
    rpc: c.rpc,
    lifecycle: c.lifecycle,
    scheduled: (cron, now) => c.cron(cron, now),
  };
}
