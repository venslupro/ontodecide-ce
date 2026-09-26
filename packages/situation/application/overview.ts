/**
 * @fileoverview Cockpit overview use case.
 */

import type {CallCtx} from '@ontodecide/shared-kernel';
import type {SituationOverview} from '../contract';
import type {SituationDeps} from './deps';
import {kpiValues, requireRole} from './support';

/** Active alerts returned by the overview. */
export const OVERVIEW_ALERTS_MAX = 50;

/** Proposed recommendations returned by the overview. */
export const OVERVIEW_RECOMMENDATIONS_MAX = 10;

/** Builds the cockpit first screen (Viewer). */
export class GetOverview {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx): Promise<SituationOverview> {
    requireRole(ctx, 'Viewer');
    const {repos} = this.deps;
    const [kpis, alerts, recommendations, usage] = await Promise.all([
      repos.kpis
        .list(ctx.tenantId)
        .then(k => kpiValues(this.deps, ctx.tenantId, k)),
      repos.alerts.listActive(ctx.tenantId, OVERVIEW_ALERTS_MAX),
      repos.recommendations.listByStatus(
        ctx.tenantId,
        'Proposed',
        OVERVIEW_RECOMMENDATIONS_MAX,
      ),
      this.deps.usage().status(),
    ]);
    return {
      kpis,
      alerts,
      usage,
      recommendations,
      generatedAt: this.deps.clock.now().toISOString(),
    };
  }
}
