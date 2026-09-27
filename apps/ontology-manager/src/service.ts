/**
 * @fileoverview ontology-manager service module (used by the Worker entry
 * point and the in-process test harness).
 */

import type {ServiceModule} from '@ontodecide/shared-kernel';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import {createContainer, type Overrides} from './container';
import type {Env} from './env';

export type {Overrides} from './container';

/** Creates the ontology-manager service (RPC + TenantLifecycle; no queues or crons). */
export function createService(
  env: Env,
  overrides: Overrides = {},
): ServiceModule<OntologyRpc> & {
  lifecycle: NonNullable<ServiceModule<OntologyRpc>['lifecycle']>;
} {
  const c = createContainer(env, overrides);
  return {rpc: c.rpc, lifecycle: c.lifecycle};
}
