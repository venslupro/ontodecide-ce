/**
 * @fileoverview identity-access service module (used by the Worker entry
 * point and by the in-process e2e harness).
 */

import type {IdentityRpc} from '@ontodecide/identity/contract';
import type {ServiceModule} from '@ontodecide/shared-kernel';
import {createContainer, type Overrides} from './container';
import type {Env} from './env';

export type {Overrides} from './container';

/** Creates the identity-access service: `{rpc, scheduled}`. */
export function createService(
  env: Env,
  overrides: Overrides = {},
): ServiceModule<IdentityRpc> {
  const c = createContainer(env, overrides);
  return {
    rpc: c.rpc,
    scheduled: (cron, now) => c.cron(cron, now),
  };
}
