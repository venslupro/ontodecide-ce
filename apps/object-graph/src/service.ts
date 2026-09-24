/**
 * @fileoverview Service module of object-graph (used by the Worker entry
 * point and the in-process test harness).
 */

import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {Clock, Logger, ServiceModule} from '@ontodecide/shared-kernel';
import {createContainer} from './container';
import type {Env} from './env';

/** Builds the object-graph service. */
export function createService(
  env: Env,
  overrides: {clock?: Clock; logger?: Logger; fetch?: typeof fetch} = {},
): ServiceModule<ObjectGraphRpc> {
  const c = createContainer(env, overrides);
  return {
    rpc: c.rpc,
    queue: batch => c.queueHandler(batch),
    scheduled: async (cron, now) => {
      await c.cron(cron, now);
    },
  };
}
