/**
 * @fileoverview Installs pack templates (automations and KPIs).
 */

import {type CallCtx, ulid} from '@ontodecide/shared-kernel';
import type {SituationDeps} from './deps';
import {toAutomationDto} from './automation_handlers';
import {requireRole} from './support';
import {nameKey, validateAutomation, validateKpi} from './validation';

/**
 * Validates every template first, then creates those whose name is not yet
 * used (idempotent by name). Returns the number created (Modeler).
 */
export class InstallPackContent {
  constructor(private readonly deps: SituationDeps) {}

  async execute(
    ctx: CallCtx,
    content: {automations?: unknown[]; kpis?: unknown[]},
  ): Promise<{automations: number; kpis: number}> {
    requireRole(ctx, 'Modeler');
    const autoDefs = (content?.automations ?? []).map(validateAutomation);
    const kpiDefs = (content?.kpis ?? []).map(validateKpi);
    const {repos, clock} = this.deps;
    const now = clock.now();

    const autoNames = new Set(
      (await repos.automations.list(ctx.tenantId)).map(a => nameKey(a.name)),
    );
    let automations = 0;
    for (const def of autoDefs) {
      const key = nameKey(def.name);
      if (autoNames.has(key)) continue;
      autoNames.add(key);
      const {id: _ignored, ...rest} = def;
      await repos.automations.save(
        ctx.tenantId,
        toAutomationDto(rest, ulid(now.getTime()), now.toISOString()),
      );
      automations++;
    }

    const kpiNames = new Set(
      (await repos.kpis.list(ctx.tenantId)).map(k => nameKey(k.name)),
    );
    let kpis = 0;
    for (const def of kpiDefs) {
      const key = nameKey(def.name);
      if (kpiNames.has(key)) continue;
      kpiNames.add(key);
      const {id: _ignored, ...rest} = def;
      await repos.kpis.save(ctx.tenantId, {
        ...rest,
        id: ulid(now.getTime()),
        value: null,
        updatedAt: null,
        createdAt: now.getTime(),
      });
      kpis++;
    }
    return {automations, kpis};
  }
}
