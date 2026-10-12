/**
 * @fileoverview Use case: clear the workspace's decision data when the user
 * resets the workspace to its blank state. Scenarios and recommendations
 * that were never executed refer to objects that no longer exist and are
 * deleted; executed recommendations stay because the object-graph action
 * audit references them.
 */

import {AppError, actorLabel, type CallCtx} from '@ontodecide/shared-kernel';
import type {DecisionDeps} from './ports';

/** Clears scenarios and unexecuted recommendations. */
export class ClearWorkspace {
  constructor(private readonly deps: DecisionDeps) {}

  async execute(
    ctx: CallCtx,
  ): Promise<{scenarios: number; recommendations: number}> {
    if (!['owner', 'admin'].includes(actorLabel(ctx))) {
      throw new AppError(
        'FORBIDDEN',
        'This principal cannot clear a workspace',
      );
    }
    const recommendations = await this.deps
      .recommendations(ctx.tid)
      .deleteUnexecuted();
    const scenarios = await this.deps.scenarios(ctx.tid).deleteAll();
    return {scenarios, recommendations};
  }
}
