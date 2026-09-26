/**
 * @fileoverview Automation rule evaluation: threshold rules are indexed in
 * memory by object type and property so only rules whose condition touches
 * a changed property are evaluated.
 */

import {
  type FilterExpr,
  filterProps,
  matchFilter,
} from '@ontodecide/shared-kernel';
import type {AutomationDto} from '../contract';

/** A changed object as delivered by `situation-events`. */
export interface ChangedObject {
  type: string;
  changed: readonly string[];
  after: Record<string, unknown>;
}

/** Default cooldown when a rule does not set one. */
export const DEFAULT_COOLDOWN_SEC = 3600;

/**
 * Whether a threshold rule fires for a change. The condition is evaluated
 * on the `after` properties; the rule is skipped when none of the
 * condition's properties changed (on first sight `changed` holds every
 * property, so the rule is evaluated).
 */
export function thresholdMatches(
  condition: FilterExpr | undefined,
  change: ChangedObject,
): boolean {
  const props = filterProps(condition);
  if (props.length > 0 && !props.some(p => change.changed.includes(p))) {
    return false;
  }
  return matchFilter(condition, change.after);
}

/** Whether an Object Set count crosses a rule threshold. */
export function countCrosses(
  count: number,
  op: 'gt' | 'lt',
  value: number,
): boolean {
  return op === 'gt' ? count > value : count < value;
}

/** In-memory inverted index of enabled threshold rules. */
export class AutomationIndex {
  /** objectType → prop → rules. */
  private readonly byProp = new Map<string, Map<string, AutomationDto[]>>();
  /** objectType → rules whose condition references no property. */
  private readonly unconditional = new Map<string, AutomationDto[]>();
  private readonly countRules: AutomationDto[] = [];
  private readonly scheduleRules: AutomationDto[] = [];

  constructor(automations: readonly AutomationDto[]) {
    for (const a of automations) {
      if (!a.enabled) continue;
      const t = a.trigger;
      if (t.kind === 'objectSetCount') this.countRules.push(a);
      else if (t.kind === 'schedule') this.scheduleRules.push(a);
      else this.addThreshold(t.objectType, a);
    }
  }

  private addThreshold(type: string, a: AutomationDto): void {
    const props = filterProps(a.condition);
    if (props.length === 0) {
      const list = this.unconditional.get(type) ?? [];
      list.push(a);
      this.unconditional.set(type, list);
      return;
    }
    const byProp = this.byProp.get(type) ?? new Map<string, AutomationDto[]>();
    for (const p of props) {
      const list = byProp.get(p) ?? [];
      list.push(a);
      byProp.set(p, list);
    }
    this.byProp.set(type, byProp);
  }

  /** Threshold rules that may fire for a change (condition not yet evaluated). */
  candidates(change: ChangedObject): AutomationDto[] {
    const seen = new Set<string>();
    const out: AutomationDto[] = [];
    const add = (a: AutomationDto) => {
      if (seen.has(a.id)) return;
      seen.add(a.id);
      out.push(a);
    };
    (this.unconditional.get(change.type) ?? []).forEach(add);
    const byProp = this.byProp.get(change.type);
    if (byProp) {
      for (const p of change.changed) (byProp.get(p) ?? []).forEach(add);
    }
    return out;
  }

  /** Threshold rules that fire for a change. */
  matching(change: ChangedObject): AutomationDto[] {
    return this.candidates(change).filter(a =>
      thresholdMatches(a.condition, change),
    );
  }

  /** objectSetCount rules whose Object Set covers one of the given types. */
  countRulesFor(types: ReadonlySet<string>): AutomationDto[] {
    return this.countRules.filter(
      a =>
        a.trigger.kind === 'objectSetCount' &&
        types.has(a.trigger.objectSet.objectType),
    );
  }

  /** Enabled schedule rules. */
  schedules(): AutomationDto[] {
    return [...this.scheduleRules];
  }
}
