/**
 * @fileoverview Service module of situation-awareness (used by the Worker
 * entry point and by the in-process test harness).
 */

import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {SituationRpc} from '@ontodecide/situation/contract';
import {type Overrides, createContainer} from './container';
import type {Env} from './env';

export type {Overrides} from './container';

/** Builds the service: RPC, queue consumer, cron and stream fetch. */
export function createService(
  env: Env,
  overrides: Overrides = {},
): ServiceModule<SituationRpc> {
  const c = createContainer(env, overrides);
  return {
    rpc: c.rpc,
    queue: batch => c.queueHandler(batch),
    scheduled: (cron, now) => c.cron(cron, now),
    fetch: request => c.fetch(request),
  };
}
