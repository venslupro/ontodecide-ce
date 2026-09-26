/**
 * @fileoverview Input validation for KPI and automation definitions (the
 * contract zod schemas plus strict filter validation).
 */

import {
  filterExprSchema,
  objectSetDefSchema,
} from '@ontodecide/object-graph/contract';
import {
  type I18nText,
  type ObjectSetDef,
  parseOrThrow,
} from '@ontodecide/shared-kernel';
import {
  type AutomationDef,
  type KpiDef,
  automationDefSchema,
  kpiDefSchema,
} from '../contract';

function objectSet(def: unknown): ObjectSetDef {
  return parseOrThrow(objectSetDefSchema, def) as ObjectSetDef;
}

/** Validates a KPI definition. */
export function validateKpi(input: unknown): KpiDef {
  const def = parseOrThrow(kpiDefSchema, input) as KpiDef;
  objectSet(def.objectSet);
  return def;
}

/** Validates an automation definition. */
export function validateAutomation(input: unknown): AutomationDef {
  const def = parseOrThrow(automationDefSchema, input) as AutomationDef;
  if (def.condition !== undefined)
    parseOrThrow(filterExprSchema, def.condition);
  if (def.trigger.kind !== 'threshold') objectSet(def.trigger.objectSet);
  return def;
}

/** Stable comparison key of a display name (pack idempotency). */
export function nameKey(name: I18nText): string {
  if (typeof name === 'string') return name;
  return JSON.stringify(
    Object.entries(name)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
