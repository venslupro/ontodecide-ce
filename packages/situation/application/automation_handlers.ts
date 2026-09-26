/**
 * @fileoverview Automation use cases: list, save, delete and dry run.
 */

import {
  AppError,
  type CallCtx,
  type ObjectSetDef,
  matchFilter,
  ulid,
} from '@ontodecide/shared-kernel';
import type {AutomationDef, AutomationDto} from '../contract';
import {DEFAULT_COOLDOWN_SEC, countCrosses} from '../domain';
import type {SituationDeps} from './deps';
import {requireRole} from './support';
import {validateAutomation} from './validation';

/** Objects inspected by a dry run. */
export const DRY_RUN_MAX_OBJECTS = 200;

/** Sample size reported by a dry run. */
export const DRY_RUN_SAMPLE = 5;

/** Builds the stored form of a validated definition. */
export function toAutomationDto(
  def: AutomationDef,
  id: string,
  createdAt: string,
  lastFiredAt?: string,
): AutomationDto {
  return {
    id,
    name: def.name,
    trigger: def.trigger,
    ...(def.condition ? {condition: def.condition} : {}),
    effects: def.effects,
    severity: def.severity,
    cooldownSec: def.cooldownSec ?? DEFAULT_COOLDOWN_SEC,
    enabled: def.enabled ?? true,
    createdAt,
    ...(lastFiredAt ? {lastFiredAt} : {}),
  };
}

/** Lists automations (Viewer). */
export class ListAutomations {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx): Promise<AutomationDto[]> {
    requireRole(ctx, 'Viewer');
    return this.deps.repos.automations.list(ctx.tenantId);
  }
}

/** Creates or updates an automation (Operator). */
export class SaveAutomation {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx, input: AutomationDef): Promise<AutomationDto> {
    requireRole(ctx, 'Operator');
    const def = validateAutomation(input);
    const {automations} = this.deps.repos;
    const existing = def.id
      ? await automations.get(ctx.tenantId, def.id)
      : null;
    if (def.id && !existing) {
      throw new AppError('NOT_FOUND', 'Automation not found');
    }
    const now = this.deps.clock.now();
    const dto = toAutomationDto(
      def,
      existing?.id ?? ulid(now.getTime()),
      existing?.createdAt ?? now.toISOString(),
      existing?.lastFiredAt,
    );
    await automations.save(ctx.tenantId, dto);
    return dto;
  }
}

/** Deletes an automation (Operator). */
export class DeleteAutomation {
  constructor(private readonly deps: SituationDeps) {}

  async execute(ctx: CallCtx, id: string): Promise<void> {
    requireRole(ctx, 'Operator');
    const ok = await this.deps.repos.automations.delete(ctx.tenantId, id);
    if (!ok) throw new AppError('NOT_FOUND', 'Automation not found');
  }
}

/** Evaluates a draft rule against current objects (Operator). */
export class DryRunAutomation {
  constructor(private readonly deps: SituationDeps) {}

  async execute(
    ctx: CallCtx,
    input: AutomationDef,
  ): Promise<{wouldFire: number; sample: string[]}> {
    requireRole(ctx, 'Operator');
    const def = validateAutomation(input);
    const t = def.trigger;
    if (t.kind === 'objectSetCount') {
      const count = await this.deps.objects.aggregate(ctx, {
        objectSet: t.objectSet,
        fn: 'count',
      });
      if (!countCrosses(count, t.op, t.value))
        return {wouldFire: 0, sample: []};
      return {wouldFire: 1, sample: [`count ${t.op} ${t.value}: ${count}`]};
    }
    const set: ObjectSetDef =
      t.kind === 'threshold' ? {objectType: t.objectType} : t.objectSet;
    const page = await this.deps.objects.evaluateObjectSet(ctx, set, {
      limit: DRY_RUN_MAX_OBJECTS,
    });
    const hits = page.items
      .slice(0, DRY_RUN_MAX_OBJECTS)
      .filter(o => matchFilter(def.condition, o.props));
    return {
      wouldFire: hits.length,
      sample: hits.slice(0, DRY_RUN_SAMPLE).map(o => o.title),
    };
  }
}
