/**
 * @fileoverview Ontology metamodel (详细设计 6.11.1): object types,
 * properties, link types, action types, declarative functions and
 * simulation KPIs, plus the template seeds situation-awareness installs.
 *
 * CE has a single version per workspace: a workspace references the shared
 * read-only template until its first change, which copies it (copy-on-write).
 */

import type {
  FilterExpr,
  I18nText,
  JsonLogic,
  OrderBy,
} from '@ontodecide/shared-kernel';

/** Property data types. `objectRef:<Type>` references another object type. */
export type DataType =
  | 'string'
  | 'integer'
  | 'double'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'geopoint'
  | 'enum'
  | `objectRef:${string}`;

/** Scalar data types (for validation of `objectRef:*`). */
export const SCALAR_TYPES = [
  'string',
  'integer',
  'double',
  'boolean',
  'date',
  'timestamp',
  'geopoint',
  'enum',
] as const;

/** Indexed properties per object type (index write amplification). */
export const MAX_INDEXED_PROPS = 8;

/** A property of an object type. */
export interface PropertyDef {
  apiName: string;
  displayName: I18nText;
  dataType: DataType;
  required?: boolean;
  unit?: string;
  /** Builds og_prop_index rows; only indexed properties filter/sort in D1. */
  indexed?: boolean;
  semanticTags?: string[];
  /** Never sent to Workers AI. */
  sensitive?: boolean;
  enumValues?: string[];
  description?: I18nText;
}

/** An object type. */
export interface ObjectTypeDef {
  apiName: string;
  displayName: I18nText;
  icon?: string;
  primaryKey: string;
  titleProperty: string;
  properties: PropertyDef[];
  description?: I18nText;
}

/** Link propagation settings used by the impact simulator. */
export interface PropagationDef {
  /** Weight used when the link has no weight of its own. 0..1. */
  defaultWeight: number;
}

/** A directed link type between two object types. */
export interface LinkTypeDef {
  apiName: string;
  displayName: I18nText;
  from: string;
  to: string;
  cardinality: 'one' | 'many';
  /** When set, impacts propagate along this link (from → to). */
  propagation?: PropagationDef;
}

/** Suggests a value for an objectRef parameter (deterministic candidates). */
export interface ParamSuggestDef {
  objectType: string;
  filter?: FilterExpr;
  orderBy: OrderBy;
  /** Only consider objects linked to the target through this link. */
  sharesLinkWithTarget?: {link: string; direction: 'in' | 'out'};
}

/** An action parameter. */
export interface ParamDef {
  apiName: string;
  displayName: I18nText;
  dataType: DataType;
  required?: boolean;
  defaultValue?: unknown;
  suggest?: ParamSuggestDef;
}

/** Precondition evaluated against `{target, params}`. */
export interface PreconditionDef {
  expr: JsonLogic;
  message: I18nText;
}

/** Effect of an action. JSONLogic data context is `{target, params}`. */
export type EffectDef =
  | {kind: 'set'; prop: string; value: JsonLogic}
  | {kind: 'increment'; prop: string; by: JsonLogic}
  | {kind: 'relink'; link: string; direction: 'in' | 'out'; toParam: string}
  | {kind: 'unlink'; link: string; direction: 'in' | 'out'; toParam?: string};

/** Relative change an action is expected to cause (for simulation). */
export interface ImpactHint {
  property: string;
  /** Relative change −1..1 applied to the action target. */
  change: number;
}

/** An action type. Actions only change objects inside the workspace. */
export interface ActionTypeDef {
  apiName: string;
  displayName: I18nText;
  targetType: string;
  parameters: ParamDef[];
  preconditions: PreconditionDef[];
  effects: EffectDef[];
  impact?: ImpactHint[];
  description?: I18nText;
}

/** A declarative (JSONLogic safe subset) function. */
export interface FunctionDef {
  apiName: string;
  displayName?: I18nText;
  objectType?: string;
  expr: JsonLogic;
  returns: DataType;
}

/** A KPI the simulator computes over the impacted subgraph. */
export interface SimulationKpiDef {
  apiName: string;
  displayName: I18nText;
  objectType: string;
  /** Property aggregated; omitted for `count`. */
  property?: string;
  agg: 'sum' | 'avg' | 'count';
  unit?: string;
  higherIsBetter: boolean;
}

/** A workspace ontology (the single version). */
export interface OntologyDef {
  objectTypes: ObjectTypeDef[];
  linkTypes: LinkTypeDef[];
  actionTypes: ActionTypeDef[];
  functions: FunctionDef[];
  simulationKpis: SimulationKpiDef[];
}

/** Editable definition collections (REST resource names). */
export type DefKind = 'object-types' | 'link-types' | 'action-types';

/** Definition type of each {@link DefKind}. */
export interface DefByKind {
  'object-types': ObjectTypeDef;
  'link-types': LinkTypeDef;
  'action-types': ActionTypeDef;
}

/** Any editable definition. */
export type TypeDef = ObjectTypeDef | LinkTypeDef | ActionTypeDef;

/** Index plan entry derived from `indexed` properties. */
export interface IndexPlanEntry {
  objectType: string;
  prop: string;
}

/** Compiled object type (adds derived lookups). */
export interface CompiledObjectType extends ObjectTypeDef {
  propsByName: Record<string, PropertyDef>;
  indexedProps: string[];
  sensitiveProps: string[];
}

/**
 * Compiled workspace ontology. Workspaces that never changed their ontology
 * share the template's compiled form.
 */
export interface CompiledSchema {
  templateId: string;
  templateVersion: string;
  /** True once the workspace has its own copy. */
  custom: boolean;
  /**
   * Schema version used for If-Match: 0 while the template is referenced,
   * then the copy's etag counter (HTTP ETag `"v{etag}"`).
   */
  etag: number;
  objectTypes: Record<string, CompiledObjectType>;
  linkTypes: Record<string, LinkTypeDef>;
  actionTypes: Record<string, ActionTypeDef>;
  functions: Record<string, FunctionDef>;
  simulationKpis: SimulationKpiDef[];
  indexPlan: IndexPlanEntry[];
}

/** Workspace ontology as returned to the UI. */
export interface OntologyDto {
  templateId: string;
  templateVersion: string;
  custom: boolean;
  etag: number;
  definition: OntologyDef;
  updatedAt: string | null;
}

/** A structural validation issue. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** KPI aggregation. */
export interface KpiAggregate {
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  prop?: string;
}

/** KPI seed shipped with a template (installed by situation-awareness). */
export interface KpiSeed {
  id: string;
  name: I18nText;
  objectType: string;
  aggregate: KpiAggregate;
  filter?: FilterExpr;
  unit?: string;
  target?: number;
  higherIsBetter?: boolean;
}

/** Automation seed shipped with a template (alert-only). */
export interface AutomationSeed {
  id: string;
  name: I18nText;
  trigger: 'threshold' | 'schedule';
  objectType: string;
  condition: FilterExpr;
  /** Schedule interval for `schedule` triggers, ≥ 1 hour. */
  everyHours?: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cooldownSec: number;
  enabled: boolean;
}

/** Seeds of a template. */
export interface TemplateSeeds {
  kpis: KpiSeed[];
  automations: AutomationSeed[];
}

/** Built-in template id ("supply chain risk"). */
export const SUPPLY_CHAIN_TEMPLATE_ID = 'supply-chain';
