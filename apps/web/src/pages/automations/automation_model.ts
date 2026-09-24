/**
 * @fileoverview Automation form model: form values ↔ AutomationDef, the
 * form schema (reusing the contract `automationDefSchema`) and
 * human-readable summaries of triggers, conditions and cooldowns.
 */

import {
  type AutomationDef,
  type AutomationDto,
  type AutomationTrigger,
  automationDefSchema,
  type Severity,
} from '@ontodecide/situation/contract';
import type {
  FilterExpr,
  FilterValue,
  I18nText,
} from '@ontodecide/shared-kernel';
import type {TFunction} from 'i18next';
import {z} from 'zod';
import {
  type FilterGroup,
  fromFilterExpr,
  newGroup,
  toFilterExpr,
} from '../../entities/object_set/filter_model';
import type {RenderProp} from '../../entities/renderers/registry';
import type {
  UiModel,
  UiObjectType,
  UiProperty,
} from '../../entities/schema/model';

/** Default cooldown (seconds). */
export const DEFAULT_COOLDOWN = 3600;

/** Maximum cooldown (seconds). */
export const MAX_COOLDOWN = 86_400;

/** Severities in ascending order. */
export const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Trigger kinds editable in the form (`keep` preserves an unsupported trigger). */
export type FormTriggerKind = 'threshold' | 'schedule' | 'keep';

/** Editable form values. */
export interface AutomationFormValues {
  nameZh: string;
  nameEn: string;
  triggerKind: FormTriggerKind;
  objectType: string;
  condition: FilterGroup;
  alert: boolean;
  recommend: boolean;
  perturb: boolean;
  perturbProperty: string;
  /** −100..100 (percent). */
  perturbChange: number;
  action: boolean;
  actionType: string;
  severity: Severity;
  cooldownSec: number;
  enabled: boolean;
}

/** Numeric data types usable for perturbations. */
const NUMERIC = new Set<string>(['integer', 'double']);

/** Visible properties of a type usable in conditions. */
export function conditionProperties(
  type: UiObjectType | undefined,
): UiProperty[] {
  return (type?.properties ?? []).filter(p => p.visible);
}

/** Visible numeric properties (perturbation targets). */
export function numericProperties(
  type: UiObjectType | undefined,
): UiProperty[] {
  return conditionProperties(type).filter(p => NUMERIC.has(p.dataType));
}

/** Property map for FilterExpr conversion. */
export function propMap(
  type: UiObjectType | undefined,
): Record<string, RenderProp> {
  return Object.fromEntries(conditionProperties(type).map(p => [p.apiName, p]));
}

/** Object type targeted by a trigger. */
export function triggerObjectType(tr: AutomationTrigger): string {
  return tr.kind === 'threshold' ? tr.objectType : tr.objectSet.objectType;
}

/** Empty form. */
export function emptyForm(): AutomationFormValues {
  return {
    nameZh: '',
    nameEn: '',
    triggerKind: 'threshold',
    objectType: '',
    condition: newGroup('and'),
    alert: true,
    recommend: false,
    perturb: false,
    perturbProperty: '',
    perturbChange: -50,
    action: false,
    actionType: '',
    severity: 'MEDIUM',
    cooldownSec: DEFAULT_COOLDOWN,
    enabled: true,
  };
}

/** Form values for an existing automation. */
export function formFromDto(a: AutomationDto): AutomationFormValues {
  const name = a.name;
  const nameZh =
    typeof name === 'string' ? name : (name['zh-CN'] ?? name['en-US'] ?? '');
  const nameEn = typeof name === 'string' ? '' : (name['en-US'] ?? '');
  const rec = a.effects.find(e => e.kind === 'recommend');
  const act = a.effects.find(e => e.kind === 'action');
  return {
    nameZh,
    nameEn,
    triggerKind: a.trigger.kind === 'objectSetCount' ? 'keep' : a.trigger.kind,
    objectType: triggerObjectType(a.trigger),
    condition: fromFilterExpr(a.condition as FilterExpr | undefined),
    alert: a.effects.some(e => e.kind === 'alert'),
    recommend: !!rec,
    perturb: !!(rec && rec.kind === 'recommend' && rec.perturbation),
    perturbProperty:
      rec && rec.kind === 'recommend' ? (rec.perturbation?.property ?? '') : '',
    perturbChange:
      rec && rec.kind === 'recommend' && rec.perturbation
        ? Math.round(rec.perturbation.change * 100)
        : -50,
    action: !!act,
    actionType: act && act.kind === 'action' ? act.actionType : '',
    severity: a.severity,
    cooldownSec: a.cooldownSec ?? DEFAULT_COOLDOWN,
    enabled: a.enabled ?? true,
  };
}

/** Builds the AutomationDef sent to the API. */
export function toDef(
  v: AutomationFormValues,
  opts: {
    id?: string;
    keptTrigger?: AutomationTrigger;
    props: Record<string, RenderProp>;
    keptParams?: Record<string, unknown>;
  },
): AutomationDef {
  const name: I18nText = v.nameEn.trim()
    ? {'zh-CN': v.nameZh.trim(), 'en-US': v.nameEn.trim()}
    : {'zh-CN': v.nameZh.trim()};
  let trigger: AutomationTrigger;
  if (v.triggerKind === 'keep' && opts.keptTrigger) trigger = opts.keptTrigger;
  else if (v.triggerKind === 'schedule')
    trigger = {kind: 'schedule', objectSet: {objectType: v.objectType}};
  else trigger = {kind: 'threshold', objectType: v.objectType};
  const effects: AutomationDef['effects'] = [];
  if (v.alert) effects.push({kind: 'alert'});
  if (v.recommend) {
    effects.push(
      v.perturb && v.perturbProperty
        ? {
            kind: 'recommend',
            perturbation: {
              property: v.perturbProperty,
              change: v.perturbChange / 100,
            },
          }
        : {kind: 'recommend'},
    );
  }
  if (v.action && v.actionType) {
    effects.push(
      opts.keptParams
        ? {kind: 'action', actionType: v.actionType, params: opts.keptParams}
        : {kind: 'action', actionType: v.actionType},
    );
  }
  const condition = toFilterExpr(v.condition, opts.props);
  const def: AutomationDef = {
    name,
    trigger,
    effects,
    severity: v.severity,
    cooldownSec: v.cooldownSec,
    enabled: v.enabled,
  };
  if (opts.id) def.id = opts.id;
  if (condition) def.condition = condition;
  return def;
}

/** The def fields of a stored automation (drops server-owned fields). */
export function defOf(a: AutomationDto): AutomationDef {
  const def: AutomationDef = {
    id: a.id,
    name: a.name,
    trigger: a.trigger,
    effects: a.effects,
    severity: a.severity,
    cooldownSec: a.cooldownSec,
    enabled: a.enabled,
  };
  if (a.condition) def.condition = a.condition;
  return def;
}

/**
 * Form schema: field rules plus a final check of the built definition
 * against the contract's `automationDefSchema`.
 */
export function makeFormSchema(
  t: TFunction,
  opts: {props: Record<string, RenderProp>; keptTrigger?: AutomationTrigger},
) {
  return z
    .object({
      nameZh: z.string().trim().min(1, t('automations.form.nameRequired')),
      nameEn: z.string(),
      triggerKind: z.enum(['threshold', 'schedule', 'keep']),
      objectType: z.string(),
      condition: z.custom<FilterGroup>(v => !!v && typeof v === 'object'),
      alert: z.boolean(),
      recommend: z.boolean(),
      perturb: z.boolean(),
      perturbProperty: z.string(),
      perturbChange: z.number().min(-100).max(100),
      action: z.boolean(),
      actionType: z.string(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
      cooldownSec: z
        .number({error: t('automations.form.cooldownRange')})
        .int(t('automations.form.cooldownRange'))
        .min(0, t('automations.form.cooldownRange'))
        .max(MAX_COOLDOWN, t('automations.form.cooldownRange')),
      enabled: z.boolean(),
    })
    .superRefine((v, ctx) => {
      let ok = true;
      if (v.triggerKind !== 'keep' && !v.objectType) {
        ctx.addIssue({
          code: 'custom',
          path: ['objectType'],
          message: t('automations.form.typeRequired'),
        });
        ok = false;
      }
      if (!v.alert && !v.recommend && !v.action) {
        ctx.addIssue({
          code: 'custom',
          path: ['alert'],
          message: t('automations.form.effectsRequired'),
        });
        ok = false;
      }
      if (v.recommend && v.perturb && !v.perturbProperty) {
        ctx.addIssue({
          code: 'custom',
          path: ['perturbProperty'],
          message: t('automations.form.perturbRequired'),
        });
        ok = false;
      }
      if (v.action && !v.actionType) {
        ctx.addIssue({
          code: 'custom',
          path: ['actionType'],
          message: t('automations.form.actionRequired'),
        });
        ok = false;
      }
      if (!ok) return;
      const r = automationDefSchema.safeParse(
        toDef(v as AutomationFormValues, opts),
      );
      if (!r.success) {
        const detail = r.error.issues
          .map(i => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        ctx.addIssue({
          code: 'custom',
          path: ['root'],
          message: t('automations.form.invalid', {detail}),
        });
      }
    });
}

// ----------------------------------------------------------------------------
// Summaries
// ----------------------------------------------------------------------------

function valueText(v: FilterValue, t: TFunction): string {
  if (typeof v === 'boolean')
    return t(v ? 'common:bool.true' : 'common:bool.false');
  return String(v);
}

/** Human-readable condition, e.g. "风险分 大于等于 70 且 状态 等于 watch". */
export function conditionSummary(
  expr: FilterExpr | Record<string, unknown> | undefined,
  type: UiObjectType | undefined,
  t: TFunction,
): string {
  if (!expr || !('op' in expr)) return t('automations.noCondition');
  const propName = (p: string) =>
    type?.properties.find(x => x.apiName === p)?.displayName ?? p;
  const walk = (e: FilterExpr, depth: number): string => {
    switch (e.op) {
      case 'and':
      case 'or': {
        const s = e.args
          .map(a => walk(a, depth + 1))
          .join(` ${t(`automations.${e.op}`)} `);
        return depth > 0 && e.args.length > 1 ? `(${s})` : s;
      }
      case 'not':
        return `${t('automations.not')} (${walk(e.arg, depth + 1)})`;
      case 'exists':
        return t('automations.exists', {prop: propName(e.prop)});
      case 'in':
        return `${propName(e.prop)} ${t('common:filter.ops.in')} ${e.values.map(v => valueText(v, t)).join(', ')}`;
      case 'contains':
        return `${propName(e.prop)} ${t('common:filter.ops.contains')} ${e.value}`;
      default:
        return `${propName(e.prop)} ${t(`common:filter.ops.${e.op}`)} ${valueText(e.value, t)}`;
    }
  };
  return walk(expr as FilterExpr, 0);
}

/** Human-readable trigger, e.g. "对象变更时 · 供应商". */
export function triggerSummary(
  tr: AutomationTrigger,
  model: UiModel,
  t: TFunction,
): string {
  const type =
    model.byName[triggerObjectType(tr)]?.displayName ?? triggerObjectType(tr);
  const kind =
    tr.kind === 'objectSetCount'
      ? t('automations.trigger.objectSetCount', {
          op: t(`common:filter.ops.${tr.op}`),
          value: tr.value,
        })
      : t(`automations.trigger.${tr.kind}`);
  return `${kind} · ${type}`;
}

/** Human-readable cooldown. */
export function cooldownText(sec: number, t: TFunction): string {
  if (!sec) return t('automations.cooldown.none');
  if (sec % 3600 === 0) return t('automations.cooldown.hours', {n: sec / 3600});
  if (sec % 60 === 0) return t('automations.cooldown.minutes', {n: sec / 60});
  return t('automations.cooldown.seconds', {n: sec});
}
