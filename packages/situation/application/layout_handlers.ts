/**
 * @fileoverview Cockpit layout use cases.
 */

import {type CallCtx, parseOrThrow} from '@ontodecide/shared-kernel';
import {type CockpitLayout, cockpitLayoutSchema} from '../contract';
import {defaultLayout} from '../domain';
import type {SituationDeps} from './deps';
import {requireRole} from './support';

/** Returns the saved layout or a default built from the KPIs (Viewer). */
export class GetLayout {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx): Promise<CockpitLayout> {
    requireRole(ctx, 'Viewer');
    const saved = await this.deps.repos.layouts.latest(ctx.tenantId);
    if (saved) return saved;
    const kpis = await this.deps.repos.kpis.list(ctx.tenantId);
    return defaultLayout(kpis.map(k => k.id));
  }
}

/** Saves a layout (Modeler). */
export class SaveLayout {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx, input: CockpitLayout): Promise<CockpitLayout> {
    requireRole(ctx, 'Modeler');
    const layout = parseOrThrow(cockpitLayoutSchema, input) as CockpitLayout;
    await this.deps.repos.layouts.save(
      ctx.tenantId,
      layout,
      this.deps.clock.now().getTime(),
    );
    return layout;
  }
}
