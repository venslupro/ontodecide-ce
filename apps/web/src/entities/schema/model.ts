/**
 * @fileoverview Frontend schema metadata (UiObjectType) derived from the
 * compiled ontology model, with display names resolved for the UI language
 * and visibility computed from the caller's markings.
 */

import type {
  ActionTypeDef,
  CompiledModel,
  DataType,
  LinkTypeDef,
  ObjectTypeDef,
  ParamDef,
  PropertyDef,
  SimulationKpiDef,
} from '@ontodecide/ontology/contract';
import {resolveText} from '@ontodecide/shared-kernel';

/** UI property. */
export interface UiProperty {
  apiName: string;
  displayName: string;
  dataType: DataType;
  unit?: string;
  indexed: boolean;
  /** False when the caller lacks one of the property's markings. */
  visible: boolean;
  required: boolean;
  semanticTags: string[];
  enumValues?: string[];
  markings: string[];
  sensitive: boolean;
  description?: string;
}

/** UI link type (as seen from one object type). */
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

/** UI action type. */
export interface UiActionType {
  apiName: string;
  displayName: string;
  targetType: string;
  parameters: UiParam[];
  requiresApproval: boolean;
  preconditions: string[];
  writeback: 'none' | 'webhook';
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
  actions: UiActionType[];
  simulationKpis: UiSimKpi[];
  schemas: {apiName: string; version: string}[];
  hash: string;
}

/** Whether the markings grant access to a property. */
export function canSee(
  required: readonly string[] | undefined,
  markings: readonly string[],
): boolean {
  if (!required || required.length === 0) return true;
  if (markings.includes('*')) return true;
  return required.every(m => markings.includes(m));
}

/** Maps a property definition. */
export function toUiProperty(
  p: PropertyDef,
  locale: string,
  markings: readonly string[],
): UiProperty {
  return {
    apiName: p.apiName,
    displayName: resolveText(p.displayName, locale, p.apiName),
    dataType: p.dataType,
    unit: p.unit,
    indexed: !!p.indexed,
    visible: canSee(p.markings, markings),
    required: !!p.required,
    semanticTags: p.semanticTags ?? [],
    enumValues: p.enumValues,
    markings: p.markings ?? [],
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
    requiresApproval: a.requiresApproval,
    preconditions: a.preconditions.map(pc => resolveText(pc.message, locale)),
    writeback: a.writeback?.kind ?? 'none',
    description: a.description ? resolveText(a.description, locale) : undefined,
  };
}

function toUiLink(l: LinkTypeDef, locale: string): UiLinkType {
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
  markings: readonly string[],
  links: readonly UiLinkType[],
  actions: readonly UiActionType[],
): UiObjectType {
  return {
    apiName: ot.apiName,
    displayName: resolveText(ot.displayName, locale, ot.apiName),
    icon: ot.icon,
    primaryKey: ot.primaryKey,
    titleProperty: ot.titleProperty,
    properties: ot.properties.map(p => toUiProperty(p, locale, markings)),
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

/** Maps a compiled model to the UI model. */
export function toUiModel(
  model: CompiledModel,
  locale: string,
  markings: readonly string[],
): UiModel {
  const links = Object.values(model.linkTypes ?? {}).map(l =>
    toUiLink(l, locale),
  );
  const actions = Object.values(model.actionTypes ?? {}).map(a =>
    toUiAction(a, locale),
  );
  const types = Object.values(model.objectTypes ?? {}).map(ot =>
    toUiObjectType(ot, locale, markings, links, actions),
  );
  return {
    types,
    byName: Object.fromEntries(types.map(t => [t.apiName, t])),
    links,
    actions,
    simulationKpis: (model.simulationKpis ?? []).map(k => toUiKpi(k, locale)),
    schemas: model.schemas ?? [],
    hash: model.hash ?? '',
  };
}

/** An empty model (before any schema is published). */
export const EMPTY_UI_MODEL: UiModel = {
  types: [],
  byName: {},
  links: [],
  actions: [],
  simulationKpis: [],
  schemas: [],
  hash: '',
};

/** Visible properties first by schema order, primary key and title first. */
export function orderedProperties(t: UiObjectType): UiProperty[] {
  const head = [t.titleProperty, t.primaryKey];
  const first = head
    .map(n => t.properties.find(p => p.apiName === n))
    .filter((p): p is UiProperty => !!p);
  return [...first, ...t.properties.filter(p => !head.includes(p.apiName))];
}

/** Properties tagged as risk indicators (shown in the Object View title area). */
export function riskProperties(t: UiObjectType): UiProperty[] {
  return t.properties.filter(p => p.semanticTags.includes('risk'));
}
