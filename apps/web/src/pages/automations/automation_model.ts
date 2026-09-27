/**
 * @fileoverview Automation form model (V2.4, alert-only): form values ↔
 * AutomationDef, validation against the contract `automationDefSchema`,
 * the scheduled-rule limits (≤ CE_LIMITS.maxScheduledAutomations per
 * workspace, interval ≥ CE_LIMITS.minScheduleHours and ≤ 24 h) that
 * disable the save button, and human-readable summaries.
 */

import {
  type AutomationDef,
  type AutomationDto,
  automationDefSchema,
  type Severity,
} from '@ontodecide/situation/contract';
import {
  CE_LIMITS,
  type FilterExpr,
  type FilterValue,
  type I18nText,
} from '@ontodecide/shared-kernel';
import type {TFunction} from 'i18next';
import {
  type FilterGroup,
  fromFilterExpr,
  newGroup,
  toFilterExpr,
} from '../../entities/schema/filter_model';
import type {RenderProp} from '../../entities/renderers/registry';
import type {UiObjectType} from '../../entities/schema/model';

/** Default cooldown, seconds. */
export const DEFAULT_COOLDOWN = CE_LIMITS.cooldownDefaultSec;
/** Maximum cooldown, seconds. */
export const MAX_COOLDOWN = CE_LIMITS.cooldownMaxSec;
/** Maximum schedule interval, hours (contract bound). */
export const MAX_SCHEDULE_HOURS = 24;

/** Severities in ascending order. */
export const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Editable form values (numbers kept as raw input). */
export interface AutomationForm {
  nameZh: string;
  nameEn: string;
  trigger: 'threshold' | 'schedule';
  everyHours: string;
  objectType: string;
  condition: FilterGroup;
  severity: Severity;
  cooldownSec: string;
  enabled: boolean;
}

/** Field errors (translated as `automations:form.error.<code>`). */
export type FormErrors = Partial<
  Record<'nameZh' | 'objectType' | 'condition' | 'cooldownSec' | 'root', string>
>;

/** Why saving is disabled (translated as `automations:block.<reason>`). */
export type SaveBlockReason =
  'scheduleLimit' | 'minInterval' | 'maxInterval' | 'intervalInteger';

/** Empty form. */
export function emptyForm(objectType = ''): AutomationForm {
  return {
    nameZh: '',
    nameEn: '',
    trigger: 'threshold',
    everyHours: '1',
    objectType,
    condition: newGroup('and'),
    severity: 'MEDIUM',
    cooldownSec: String(DEFAULT_COOLDOWN),
    enabled: true,
  };
}

/** Form values of a stored automation. */
export function formFromDto(a: AutomationDto | AutomationDef): AutomationForm {
  const name = a.name;
  return {
    nameZh:
      typeof name === 'string' ? name : (name['zh-CN'] ?? name['en-US'] ?? ''),
    nameEn: typeof name === 'string' ? '' : (name['en-US'] ?? ''),
    trigger: a.trigger,
    everyHours: String(a.everyHours ?? 1),
    objectType: a.objectType,
    condition: fromFilterExpr(a.condition),
    severity: a.severity,
    cooldownSec: String(a.cooldownSec ?? DEFAULT_COOLDOWN),
    enabled: a.enabled ?? true,
  };
}

/** Property map (api name → renderer metadata) of an object type. */
export function propMap(
  type: UiObjectType | undefined,
): Record<string, RenderProp> {
  return Object.fromEntries((type?.properties ?? []).map(p => [p.apiName, p]));
}

/** Builds the AutomationDef; `condition` is undefined while incomplete. */
export function toDef(
  f: AutomationForm,
  props: Record<string, RenderProp>,
): Omit<AutomationDef, 'condition'> & {condition?: FilterExpr} {
  const zh = f.nameZh.trim();
  const en = f.nameEn.trim();
  const name: I18nText = en ? {'zh-CN': zh, 'en-US': en} : {'zh-CN': zh};
  const def: Omit<AutomationDef, 'condition'> & {condition?: FilterExpr} = {
    name,
    trigger: f.trigger,
    objectType: f.objectType,
    condition: toFilterExpr(f.condition, props),
    severity: f.severity,
    cooldownSec: Number(f.cooldownSec),
    enabled: f.enabled,
  };
  if (f.trigger === 'schedule') def.everyHours = Number(f.everyHours);
  return def;
}

/** Scheduled rules in the workspace, excluding `exceptId`. */
export function scheduledCount(
  list: readonly AutomationDto[],
  exceptId?: string,
): number {
  return list.filter(a => a.trigger === 'schedule' && a.id !== exceptId).length;
}

/**
 * Reason the save button is disabled, or null. A 4th scheduled rule or an
 * interval outside 1..24 whole hours cannot be saved.
 */
export function saveBlockReason(
  f: AutomationForm,
  list: readonly AutomationDto[],
  editingId?: string,
): SaveBlockReason | null {
  if (f.trigger !== 'schedule') return null;
  if (scheduledCount(list, editingId) >= CE_LIMITS.maxScheduledAutomations)
    return 'scheduleLimit';
  const raw = f.everyHours.trim();
  const h = raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(h) || h < CE_LIMITS.minScheduleHours)
    return 'minInterval';
  if (!Number.isInteger(h)) return 'intervalInteger';
  if (h > MAX_SCHEDULE_HOURS) return 'maxInterval';
  return null;
}

/**
 * Validates the form; returns the definition when valid. Errors hold
 * message codes; `root` carries the contract schema message.
 */
export function validateForm(
  f: AutomationForm,
  props: Record<string, RenderProp>,
): {def?: AutomationDef; errors: FormErrors} {
  const errors: FormErrors = {};
  if (!f.nameZh.trim()) errors.nameZh = 'nameRequired';
  if (!f.objectType) errors.objectType = 'typeRequired';
  const cd = f.cooldownSec.trim() === '' ? NaN : Number(f.cooldownSec);
  if (!Number.isInteger(cd) || cd < 0 || cd > MAX_COOLDOWN)
    errors.cooldownSec = 'cooldownRange';
  const def = toDef(f, props);
  if (!def.condition) errors.condition = 'conditionRequired';
  if (Object.keys(errors).length) return {errors};
  const parsed = automationDefSchema.safeParse(def);
  if (!parsed.success) {
    return {
      errors: {
        root: parsed.error.issues
          .map(i => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      },
    };
  }
  return {def: def as AutomationDef, errors};
}

// --- Summaries ---------------------------------------------------------------

function valueText(v: FilterValue, t: TFunction): string {
  if (typeof v === 'boolean') return t(v ? 'bool.true' : 'bool.false');
  return String(v);
}

/** Human-readable condition, e.g. "周产能 小于 5000 且 状态 等于 watch". */
export function conditionSummary(
  expr: FilterExpr | undefined,
  type: UiObjectType | undefined,
  t: TFunction,
): string {
  if (!expr) return t('summary.noCondition');
  const propName = (p: string) =>
    type?.properties.find(x => x.apiName === p)?.displayName ?? p;
  const walk = (e: FilterExpr, depth: number): string => {
    switch (e.op) {
      case 'and':
      case 'or': {
        const s = e.args
          .map(a => walk(a, depth + 1))
          .join(` ${t(`summary.${e.op}`)} `);
        return depth > 0 && e.args.length > 1 ? `(${s})` : s;
      }
      case 'not':
        return `${t('summary.not')} (${walk(e.arg, depth + 1)})`;
      case 'exists':
        return `${propName(e.prop)} ${t('ops.exists')}`;
      case 'in':
        return `${propName(e.prop)} ${t('ops.in')} ${e.values.map(v => valueText(v, t)).join(', ')}`;
      case 'contains':
        return `${propName(e.prop)} ${t('ops.contains')} ${e.value}`;
      default:
        return `${propName(e.prop)} ${t(`ops.${e.op}`)} ${valueText(e.value, t)}`;
    }
  };
  return walk(expr, 0);
}

/** Human-readable trigger: threshold, or "every n h". */
export function triggerSummary(
  a: Pick<AutomationDef, 'trigger' | 'everyHours'>,
  t: TFunction,
): string {
  return a.trigger === 'schedule'
    ? t('summary.every', {count: a.everyHours ?? 1})
    : t('summary.threshold');
}

/** Human-readable cooldown. */
export function cooldownText(sec: number, t: TFunction): string {
  if (!sec) return t('summary.cooldownNone');
  if (sec % 3600 === 0) return t('summary.cooldownHours', {count: sec / 3600});
  if (sec % 60 === 0) return t('summary.cooldownMinutes', {count: sec / 60});
  return t('summary.cooldownSeconds', {count: sec});
}
