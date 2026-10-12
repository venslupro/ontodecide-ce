/**
 * @fileoverview Use case: clear the workspace's integration data when the
 * user resets the workspace to its blank state. Unfinished import jobs are
 * failed so no further batch lands on the cleared graph, and saved mappings
 * are deleted because they target the ontology being cleared. Job history
 * and usage counters stay.
 */

import {AppError, actorLabel} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {IntegrationDeps} from './ports';

/** Clears unfinished jobs and saved mappings; see the file overview. */
export async function clearWorkspace(
  deps: IntegrationDeps,
  ctx: CallCtx,
): Promise<{jobs: number; mappings: number}> {
  if (!['owner', 'admin'].includes(actorLabel(ctx))) {
    throw new AppError('FORBIDDEN', 'This principal cannot clear a workspace');
  }
  return deps.jobs(ctx).clearWorkspace(deps.clock.now().getTime());
}
