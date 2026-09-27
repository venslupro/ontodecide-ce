/**
 * @fileoverview Automation rules (alert-only; 修订说明书 12.2): validation of
 * the CE limits, schedule arithmetic and the in-memory inverted index that
 * maps (objectType, property) to threshold rules.
 */

import {
  AppError,
  CE_LIMITS,
  type FilterExpr,
  HOUR_MS,
  filterProps,
} from '@ontodecide/shared-kernel';
import type {AutomationDef} from '../contract/types';

/** A stored rule as the domain sees it. */
export interface AutomationRule {
  id: string;
  trigger: 'threshold' | 'schedule';
  objectType: string;
  condition: FilterExpr;
  everyHours: number | null;
  enabled: boolean;
  cooldownSec: number;
}

/**
 * Validates a definition against the CE limits and normalizes it.
 * `otherScheduled` is the number of scheduled rules other than the one being
 * written. Throws VALIDATION_FAILED.
 */
export function validateAutomation(
  def: AutomationDef,
  otherScheduled: number,
): AutomationDef {
  const fail = (detail: string, path: string): never => {
    throw new AppError('VALIDATION_FAILED', detail, {
      extras: {errors: [{path, message: detail}]},
    });
  };
  if (
    !Number.isInteger(def.cooldownSec) ||
    def.cooldownSec < 0 ||
    def.cooldownSec > CE_LIMITS.cooldownMaxSec
  ) {
    fail('cooldownSec must be between 0 and 86400', 'cooldownSec');
  }
  if (def.trigger === 'threshold') {
    const {everyHours: _ignored, ...rest} = def;
    return rest;
  }
  const h = def.everyHours;
  if (
    h === undefined ||
    !Number.isInteger(h) ||
    h < CE_LIMITS.minScheduleHours ||
    h > 24
  ) {
    fail('everyHours must be an integer between 1 and 24', 'everyHours');
  }
  if (otherScheduled >= CE_LIMITS.maxScheduledAutomations) {
    fail(
      `At most ${CE_LIMITS.maxScheduledAutomations} scheduled automations per workspace`,
      'trigger',
    );
  }
  return def;
}

/** First run of a scheduled rule created or changed at `now`. */
export function firstRunAt(now: number, everyHours: number): number {
  return now + everyHours * HOUR_MS;
}

/**
 * Next run after a run that was due at `due`, keeping the phase and
 * skipping missed slots so the result is always after `now`.
 */
export function advanceRun(
  due: number,
  everyHours: number,
  now: number,
): number {
  const step = everyHours * HOUR_MS;
  let next = due + step;
  if (next <= now) next += Math.ceil((now - next + 1) / step) * step;
  return next;
}

/** Earliest instant among the candidates (null when none). */
export function earliest(
  ...candidates: (number | null | undefined)[]
): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    if (c === null || c === undefined || !Number.isFinite(c)) continue;
    if (best === null || c < best) best = c;
  }
  return best;
}

/**
 * Inverted index of enabled threshold rules by (objectType, property).
 * Rules whose condition references no property are indexed per type.
 */
export class RuleIndex {
  private readonly byProp = new Map<string, AutomationRule[]>();
  private readonly byType = new Map<string, AutomationRule[]>();

  constructor(rules: readonly AutomationRule[]) {
    for (const r of rules) {
      if (!r.enabled || r.trigger !== 'threshold') continue;
      push(this.byType, r.objectType, r);
      const props = filterProps(r.condition);
      for (const p of props.length ? props : ['*']) {
        push(this.byProp, key(r.objectType, p), r);
      }
    }
  }

  /** Every enabled threshold rule for an object type. */
  forType(objectType: string): AutomationRule[] {
    return this.byType.get(objectType) ?? [];
  }

  /**
   * Rules to evaluate after an object changed: all rules of the type when
   * the object is new or removed, otherwise those referencing a changed
   * property (plus property-less rules).
   */
  candidates(
    objectType: string,
    changed: readonly string[],
    wholeObject: boolean,
  ): AutomationRule[] {
    if (wholeObject) return this.forType(objectType);
    const out = new Map<string, AutomationRule>();
    for (const p of [...changed, '*']) {
      for (const r of this.byProp.get(key(objectType, p)) ?? []) {
        out.set(r.id, r);
      }
    }
    return [...out.values()];
  }
}

function key(type: string, prop: string): string {
  return `${type}\u0000${prop}`;
}

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
