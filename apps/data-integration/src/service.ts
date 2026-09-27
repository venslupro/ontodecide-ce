/**
 * @fileoverview data-integration service module (used by the Worker entry
 * point and by the in-process e2e harness).
 */

import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {IntegrationRpc} from '@ontodecide/integration/contract';
import {createContainer} from './container';
import type {Overrides} from './container';
import type {Env} from './env';

export type {Overrides} from './container';

/** Creates the data-integration service. */
export function createService(
  env: Env,
  overrides: Overrides = {},
): ServiceModule<IntegrationRpc> {
  const c = createContainer(env, overrides);
  return {rpc: c.rpc, lifecycle: c.lifecycle};
}
