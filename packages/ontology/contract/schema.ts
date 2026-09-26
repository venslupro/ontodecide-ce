/**
 * @fileoverview Ontology metamodel: object types, properties, link types,
 * action types, declarative functions and simulation KPIs.
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

/** A property of an object type. */
export interface PropertyDef {
  apiName: string;
  displayName: I18nText;
  dataType: DataType;
  required?: boolean;
  unit?: string;
  /** Builds og_prop_index rows; only indexed properties can be filtered/sorted in D1. */
  indexed?: boolean;
  /** Markings a caller must hold to see this property. */
  markings?: string[];
  semanticTags?: string[];
  /** Never sent to external LLM providers. */
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
  /** Projected into Neo4j for deep traversal. */
  graphProjected?: boolean;
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

/** Suggests a value for an objectRef parameter (candidate prefilling). */
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

/** Where an executed action is written back. */
export type WritebackDef = {kind: 'none'} | {kind: 'webhook'; url: string};

/** An action type. */
export interface ActionTypeDef {
  apiName: string;
  displayName: I18nText;
  targetType: string;
  parameters: ParamDef[];
  preconditions: PreconditionDef[];
  effects: EffectDef[];
  requiresApproval: boolean;
  impact?: ImpactHint[];
  writeback?: WritebackDef;
  description?: I18nText;
}

/** A declarative (JSONLogic) function. */
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

/** A full ontology schema (the unit of versioning and publishing). */
export interface SchemaDef {
  apiName: string;
  displayName: I18nText;
  /** Semantic version, e.g. `1.2.0`. Set by publish when omitted. */
  version?: string;
  description?: I18nText;
  objectTypes: ObjectTypeDef[];
  linkTypes: LinkTypeDef[];
  actionTypes: ActionTypeDef[];
  functions: FunctionDef[];
  simulationKpis?: SimulationKpiDef[];
}

/** Index plan entry derived from `indexed` properties. */
export interface IndexPlanEntry {
  objectType: string;
  prop: string;
  kind: 'num' | 'str';
}

/** Compiled object type (adds derived lookups). */
export interface CompiledObjectType extends ObjectTypeDef {
  schemaApi: string;
  propsByName: Record<string, PropertyDef>;
  indexedProps: string[];
  sensitiveProps: string[];
}

/** Compiled single schema. */
export interface CompiledSchema {
  apiName: string;
  version: string;
  hash: string;
  objectTypes: Record<string, CompiledObjectType>;
  linkTypes: Record<string, LinkTypeDef>;
  actionTypes: Record<string, ActionTypeDef>;
  functions: Record<string, FunctionDef>;
  simulationKpis: SimulationKpiDef[];
  indexPlan: IndexPlanEntry[];
}

/**
 * The tenant's active model: all published schemas merged. Object, link and
 * action type api names are unique across a tenant's schemas.
 */
export interface CompiledModel extends Omit<CompiledSchema, 'apiName'> {
  tenantId: string;
  schemas: {apiName: string; version: string}[];
}

/** Schema lifecycle status. */
export type SchemaStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED';

/** One stored schema version. */
export interface SchemaDto {
  apiName: string;
  version: string;
  status: SchemaStatus;
  definition: SchemaDef;
  publishedBy?: string;
  publishedAt?: string;
}

/** Listing entry. */
export interface SchemaSummary {
  apiName: string;
  displayName: I18nText;
  currentVersion: string | null;
  hasDraft: boolean;
  objectTypeCount: number;
  publishedAt?: string;
}

/** Result of saving a draft. */
export interface DraftDto {
  apiName: string;
  version: string;
  savedAt: string;
  validation: ValidationIssue[];
}

/** A structural validation issue. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** One change in a schema diff. */
export interface SchemaChange {
  kind:
    | 'objectTypeAdded'
    | 'objectTypeRemoved'
    | 'propertyAdded'
    | 'propertyRemoved'
    | 'propertyTypeChanged'
    | 'propertyChanged'
    | 'linkTypeAdded'
    | 'linkTypeRemoved'
    | 'actionTypeAdded'
    | 'actionTypeRemoved'
    | 'actionTypeChanged';
  path: string;
  breaking: boolean;
  detail?: string;
}

/** Draft vs current comparison. */
export interface DiffReport {
  apiName: string;
  fromVersion: string | null;
  toVersion: string;
  breaking: boolean;
  changes: SchemaChange[];
  /** Suggested next version following semver. */
  suggestedVersion: string;
}

/** Publish outcome. */
export interface PublishReport {
  apiName: string;
  version: string;
  diff: DiffReport;
  indexChanges: IndexPlanEntry[];
  publishedAt: string;
}

/** Scenario package content (schema + situation templates + sample data). */
export interface OntologyPack {
  id: string;
  name: I18nText;
  version: string;
  description?: I18nText;
  schema: SchemaDef;
  /** Opaque to ontology-manager; installed by situation-awareness. */
  automations?: unknown[];
  /** Opaque to ontology-manager; installed by situation-awareness. */
  kpis?: unknown[];
  sampleData?: {objectType: string; rows: Record<string, unknown>[]}[];
}

/** Pack listing entry. */
export interface PackSummary {
  id: string;
  name: I18nText;
  version: string;
  description?: I18nText;
  builtIn: boolean;
}
