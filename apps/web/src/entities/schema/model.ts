/**
 * @fileoverview Frontend schema metadata (UiObjectType) derived from the
 * workspace ontology (`GET /ontology`), with display names resolved for the
 * UI language. Everything ontology-driven in the UI (object table columns,
 * filters, action forms, Object View layout, import mapping targets) is
 * built from this model (前端详细设计 图 5).
 */

import type {
  ActionTypeDef,
  DataType,
  LinkTypeDef,
  ObjectTypeDef,
  OntologyDto,
  ParamDef,
  PropertyDef,
  SimulationKpiDef,
} from '@ontodecide/ontology/contract';
import {type JsonLogic, resolveText} from '@ontodecide/shared-kernel';

/** UI property. */
export interface UiProperty {
  apiName: string;
  displayName: string;
  dataType: DataType;
  unit?: string;
  indexed: boolean;
  required: boolean;
  semanticTags: string[];
  enumValues?: string[];
  sensitive: boolean;
  description?: string;
}

/** UI link type. */
export interface UiLinkType {
  apiName: string;
  displayName: string;
  from: string;
  to: string;
  cardinality: 'one' | 'many';
  propagates: boolean;
}

/** UI action parameter. */
export interface UiParam {
  apiName: string;
  displayName: string;
  dataType: DataType;
  required: boolean;
  defaultValue?: unknown;
  suggest?: ParamDef['suggest'];
}

/** UI precondition (expression + localized message). */
export interface UiPrecondition {
  expr: JsonLogic;
  message: string;
}

/** UI action type. */
export interface UiActionType {
  apiName: string;
  displayName: string;
  targetType: string;
  parameters: UiParam[];
  preconditions: UiPrecondition[];
  description?: string;
}

/** UI object type. */
export interface UiObjectType {
  apiName: string;
  displayName: string;
  icon?: string;
  primaryKey: string;
  titleProperty: string;
  properties: UiProperty[];
  links: UiLinkType[];
  actions: UiActionType[];
  description?: string;
}

/** UI simulation KPI. */
export interface UiSimKpi {
  apiName: string;
  displayName: string;
  unit?: string;
  higherIsBetter: boolean;
}

/** The whole UI model. */
export interface UiModel {
  types: UiObjectType[];
  byName: Record<string, UiObjectType>;
  links: UiLinkType[];
  linksByName: Record<string, UiLinkType>;
  actions: UiActionType[];
  actionsByName: Record<string, UiActionType>;
  simulationKpis: UiSimKpi[];
  /** Schema version for If-Match (0 while the template is referenced). */
  etag: number;
  /** True once the workspace has its own copy of the template. */
  custom: boolean;
  templateId: string;
}

/** Maps a property definition. */
export function toUiProperty(p: PropertyDef, locale: string): UiProperty {
  return {
    apiName: p.apiName,
    displayName: resolveText(p.displayName, locale, p.apiName),
    dataType: p.dataType,
    unit: p.unit,
    indexed: !!p.indexed,
    required: !!p.required,
    semanticTags: p.semanticTags ?? [],
    enumValues: p.enumValues,
    sensitive: !!p.sensitive,
    description: p.description ? resolveText(p.description, locale) : undefined,
  };
}

/** Maps an action type definition. */
export function toUiAction(a: ActionTypeDef, locale: string): UiActionType {
  return {
    apiName: a.apiName,
    displayName: resolveText(a.displayName, locale, a.apiName),
    targetType: a.targetType,
    parameters: a.parameters.map(p => ({
      apiName: p.apiName,
      displayName: resolveText(p.displayName, locale, p.apiName),
      dataType: p.dataType,
      required: !!p.required,
      defaultValue: p.defaultValue,
      suggest: p.suggest,
    })),
    preconditions: a.preconditions.map(pc => ({
      expr: pc.expr,
      message: resolveText(pc.message, locale),
    })),
    description: a.description ? resolveText(a.description, locale) : undefined,
  };
}

/** Maps a link type definition. */
export function toUiLink(l: LinkTypeDef, locale: string): UiLinkType {
  return {
    apiName: l.apiName,
    displayName: resolveText(l.displayName, locale, l.apiName),
    from: l.from,
    to: l.to,
    cardinality: l.cardinality,
    propagates: !!l.propagation,
  };
}

/** Maps an object type definition given all links and actions. */
export function toUiObjectType(
  ot: ObjectTypeDef,
  locale: string,
  links: readonly UiLinkType[],
  actions: readonly UiActionType[],
): UiObjectType {
  return {
    apiName: ot.apiName,
    displayName: resolveText(ot.displayName, locale, ot.apiName),
    icon: ot.icon,
    primaryKey: ot.primaryKey,
    titleProperty: ot.titleProperty,
    properties: ot.properties.map(p => toUiProperty(p, locale)),
    links: links.filter(l => l.from === ot.apiName || l.to === ot.apiName),
    actions: actions.filter(a => a.targetType === ot.apiName),
    description: ot.description
      ? resolveText(ot.description, locale)
      : undefined,
  };
}

function toUiKpi(k: SimulationKpiDef, locale: string): UiSimKpi {
  return {
    apiName: k.apiName,
    displayName: resolveText(k.displayName, locale, k.apiName),
    unit: k.unit,
    higherIsBetter: k.higherIsBetter,
  };
}

/** Maps the workspace ontology to the UI model. */
export function toUiModel(o: OntologyDto, locale: string): UiModel {
  const def = o.definition;
  const links = (def.linkTypes ?? []).map(l => toUiLink(l, locale));
  const actions = (def.actionTypes ?? []).map(a => toUiAction(a, locale));
  const types = (def.objectTypes ?? []).map(ot =>
    toUiObjectType(ot, locale, links, actions),
  );
  return {
    types,
    byName: Object.fromEntries(types.map(t => [t.apiName, t])),
    links,
    linksByName: Object.fromEntries(links.map(l => [l.apiName, l])),
    actions,
    actionsByName: Object.fromEntries(actions.map(a => [a.apiName, a])),
    simulationKpis: (def.simulationKpis ?? []).map(k => toUiKpi(k, locale)),
    etag: o.etag,
    custom: o.custom,
    templateId: o.templateId,
  };
}

/** An empty model (while loading). */
export const EMPTY_UI_MODEL: UiModel = {
  types: [],
  byName: {},
  links: [],
  linksByName: {},
  actions: [],
  actionsByName: {},
  simulationKpis: [],
  etag: 0,
  custom: false,
  templateId: '',
};

/** Properties in ontology order with the title and primary key first. */
export function orderedProperties(t: UiObjectType): UiProperty[] {
  const head = [t.titleProperty, t.primaryKey];
  const first = head
    .map(n => t.properties.find(p => p.apiName === n))
    .filter((p, i, arr): p is UiProperty => !!p && arr.indexOf(p) === i);
  return [...first, ...t.properties.filter(p => !head.includes(p.apiName))];
}

/** Properties tagged as risk indicators (shown in the Object View header). */
export function riskProperties(t: UiObjectType): UiProperty[] {
  return t.properties.filter(p => p.semanticTags.includes('risk'));
}

/** Numeric properties (perturbations, thresholds, sorting). */
export function numericProperties(t: UiObjectType | undefined): UiProperty[] {
  return (t?.properties ?? []).filter(
    p => p.dataType === 'integer' || p.dataType === 'double',
  );
}

/** Object type api name encoded in a RID (`ri.<Type>.<ulid>`). */
export function typeOfRid(rid: string): string | undefined {
  const parts = rid.split('.');
  return parts.length === 3 && parts[0] === 'ri' ? parts[1] : undefined;
}

/** Short display form of a RID (`Type·ABC123`). */
export function shortRid(rid: string): string {
  const parts = rid.split('.');
  return parts.length === 3 ? `${parts[1]}·${parts[2].slice(-6)}` : rid;
}
