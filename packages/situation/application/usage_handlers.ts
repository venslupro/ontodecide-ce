/**
 * @fileoverview Usage metering use cases (UsageGuard).
 */

import type {
  CallCtx,
  UsageResource,
  UsageStatus,
} from '@ontodecide/shared-kernel';
import {isUsageResource} from '../domain';
import type {SituationDeps} from './deps';
import {requireRole} from './support';

/** Adds a batch of usage counts (called by other services). */
export class RecordUsage {
  constructor(private readonly deps: SituationDeps) {}

  async execute(
    batch: {resource: UsageResource; n: number}[],
  ): Promise<UsageStatus> {
    const valid = (Array.isArray(batch) ? batch : []).filter(
      b => isUsageResource(b?.resource) && Number.isFinite(b.n) && b.n > 0,
    );
    const guard = this.deps.usage();
    return valid.length > 0 ? guard.record(valid) : guard.status();
  }
}

/** Current usage status (Viewer). */
export class GetUsage {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx): Promise<UsageStatus> {
    requireRole(ctx, 'Viewer');
    return this.deps.usage().status();
  }
}
