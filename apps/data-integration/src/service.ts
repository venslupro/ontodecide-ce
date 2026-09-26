/**
 * @fileoverview Service module of data-integration (used by the Worker
 * entry and the in-process e2e harness).
 */

import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {IntegrationRpc} from '@ontodecide/integration/contract';
import {createContainer} from './container';
import type {Overrides} from './container';
import type {Env} from './env';

export type {Overrides} from './container';

/** Builds the data-integration service. */
export function createService(
  env: Env,
  overrides: Overrides = {},
): ServiceModule<IntegrationRpc> {
  const c = createContainer(env, overrides);
  return {
    rpc: c.rpc,
    queue: batch => c.queueHandler(batch),
    scheduled: (cron, now) => c.cron(cron, now),
  };
}
