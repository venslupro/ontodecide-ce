/**
 * @fileoverview decision-engine service module (used by the Worker entry
 * point and the in-process test harness).
 */

import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {DecisionRpc} from '@ontodecide/decision/contract';
import {createContainer, type Overrides} from './container';
import type {Env} from './env';

export type {Overrides} from './container';

/** Creates the service. `overrides.llm` replaces the whole provider chain. */
export function createService(
  env: Env,
  overrides: Overrides = {},
): ServiceModule<DecisionRpc> {
  const c = createContainer(env, overrides);
  return {
    rpc: c.rpc,
    queue: batch => c.queueHandler(batch),
    scheduled: (cron, now) => c.cron(cron, now),
  };
}
