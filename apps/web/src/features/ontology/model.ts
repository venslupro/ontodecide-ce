/**
 * @fileoverview Ontology workbench form model: editable forms for object,
 * link and action types, conversion form ↔ definition, validation with the
 * contract zod schemas (`defSchemas`) plus workbench rules (unique names,
 * ≤ MAX_INDEXED_PROPS indexed properties, references to existing
 * definitions), server field errors, and the schema graph.
 */

import {
  type ActionTypeDef,
  type DataType,
  type DefKind,
  defSchemas,
  type EffectDef,
  type LinkTypeDef,
  MAX_INDEXED_PROPS,
  type ObjectTypeDef,
  type OntologyDef,
  type OntologyDto,
  type ParamDef,
  type PropertyDef,
  SCALAR_TYPES,
  type TypeDef,
} from '@ontodecide/ontology/contract';
import {
  type I18nText,
  type JsonLogic,
  resolveText,
} from '@ontodecide/shared-kernel';
import {isApiError} from '../../shared/api/errors';
import type {GEdge, GNode} from '../../shared/graph/limit';

export {MAX_INDEXED_PROPS};

/** Scalar data types offered in the data type select. */
export const SCALAR_DATA_TYPES = SCALAR_TYPES;

/** zh-CN / en-US text pair edited in forms. */
export interface I18nPair {
  zh: string;
  en: string;
}

/** Converts I18nText to an editable pair. */
export function toPair(text: I18nText | undefined): I18nPair {
  if (text === undefined) return {zh: '', en: ''};
  if (typeof text === 'string') return {zh: text, en: ''};
  return {zh: text['zh-CN'] ?? '', en: text['en-US'] ?? ''};
}

/** Converts a pair back to I18nText (empty English is omitted). */
export function fromPair(p: I18nPair): I18nText {
  const zh = p.zh.trim();
  const en = p.en.trim();
  return en ? {'zh-CN': zh, 'en-US': en} : {'zh-CN': zh};
}

// --- Forms -----------------------------------------------------------------

/** Editable property. */
export interface PropertyForm {
  key: string;
  apiName: string;
  displayName: I18nPair;
  dataType: string;
  unit: string;
  required: boolean;
  indexed: boolean;
  sensitive: boolean;
  semanticTags: string[];
  enumValues: string[];
  /** Fields not edited by the workbench, preserved on save. */
  keep?: Pick<PropertyDef, 'description'>;
}

/** Editable object type. */
export interface ObjectTypeForm {
  kind: 'object-types';
  apiName: string;
  displayName: I18nPair;
  icon: string;
  primaryKey: string;
  titleProperty: string;
  properties: PropertyForm[];
  keep?: Pick<ObjectTypeDef, 'description'>;
}

/** Editable link type. */
export interface LinkTypeForm {
  kind: 'link-types';
  apiName: string;
  displayName: I18nPair;
  from: string;
  to: string;
  cardinality: 'one' | 'many';
  propagates: boolean;
  /** Raw input of the propagation default weight (0..1). */
  defaultWeight: string;
}

/** Editable action parameter. */
export interface ParamForm {
  key: string;
  apiName: string;
  displayName: I18nPair;
  dataType: string;
  required: boolean;
  keep?: Pick<ParamDef, 'defaultValue' | 'suggest'>;
}

/** Editable precondition (JSONLogic as JSON text). */
export interface PreconditionForm {
  key: string;
  exprText: string;
  message: I18nPair;
}

/** Editable effect (JSONLogic values as JSON text). */
export interface EffectForm {
  key: string;
  kind: EffectDef['kind'];
  prop: string;
  valueText: string;
  link: string;
  direction: 'in' | 'out';
  toParam: string;
}

/** Editable impact hint. */
export interface ImpactForm {
  key: string;
  property: string;
  /** Raw input, −1..1. */
  change: string;
}

/** Editable action type. */
export interface ActionTypeForm {
  kind: 'action-types';
  apiName: string;
  displayName: I18nPair;
  targetType: string;
  parameters: ParamForm[];
  preconditions: PreconditionForm[];
  effects: EffectForm[];
  impact: ImpactForm[];
  keep?: Pick<ActionTypeDef, 'description'>;
}

/** Any definition form. */
export type DefForm = ObjectTypeForm | LinkTypeForm | ActionTypeForm;

let seq = 0;
/** Unique React key for list rows. */
export function rowKey(): string {
  seq += 1;
  return `r${seq}`;
}

const json = (v: unknown) => (v === undefined ? '' : JSON.stringify(v));

/** New empty property. */
export function newPropertyForm(apiName = ''): PropertyForm {
  return {
    key: rowKey(),
    apiName,
    displayName: {zh: '', en: ''},
    dataType: 'string',
    unit: '',
    required: false,
    indexed: false,
    sensitive: false,
    semanticTags: [],
    enumValues: [],
  };
}

/** Property definition → form row. */
export function propertyToForm(p: PropertyDef): PropertyForm {
  return {
    key: rowKey(),
    apiName: p.apiName,
    displayName: toPair(p.displayName),
    dataType: p.dataType,
    unit: p.unit ?? '',
    required: !!p.required,
    indexed: !!p.indexed,
    sensitive: !!p.sensitive,
    semanticTags: [...(p.semanticTags ?? [])],
    enumValues: [...(p.enumValues ?? [])],
    keep:
      p.description !== undefined ? {description: p.description} : undefined,
  };
}

/** Object type definition → form. */
export function objectTypeToForm(d: ObjectTypeDef): ObjectTypeForm {
  return {
    kind: 'object-types',
    apiName: d.apiName,
    displayName: toPair(d.displayName),
    icon: d.icon ?? '',
    primaryKey: d.primaryKey,
    titleProperty: d.titleProperty,
    properties: d.properties.map(propertyToForm),
    keep:
      d.description !== undefined ? {description: d.description} : undefined,
  };
}

/** Link type definition → form. */
export function linkTypeToForm(d: LinkTypeDef): LinkTypeForm {
  return {
    kind: 'link-types',
    apiName: d.apiName,
    displayName: toPair(d.displayName),
    from: d.from,
    to: d.to,
    cardinality: d.cardinality,
    propagates: !!d.propagation,
    defaultWeight: String(d.propagation?.defaultWeight ?? 0.5),
  };
}

function effectToForm(e: EffectDef): EffectForm {
  const base: EffectForm = {
    key: rowKey(),
    kind: e.kind,
    prop: '',
    valueText: '',
    link: '',
    direction: 'out',
    toParam: '',
  };
  switch (e.kind) {
    case 'set':
      return {...base, prop: e.prop, valueText: json(e.value)};
    case 'increment':
      return {...base, prop: e.prop, valueText: json(e.by)};
    case 'relink':
      return {
        ...base,
        link: e.link,
        direction: e.direction,
        toParam: e.toParam,
      };
    case 'unlink':
      return {
        ...base,
        link: e.link,
        direction: e.direction,
        toParam: e.toParam ?? '',
      };
  }
}

/** New empty effect. */
export function newEffectForm(kind: EffectDef['kind'] = 'set'): EffectForm {
  return {
    key: rowKey(),
    kind,
    prop: '',
    valueText: '',
    link: '',
    direction: 'out',
    toParam: '',
  };
}

/** New empty parameter. */
export function newParamForm(): ParamForm {
  return {
    key: rowKey(),
    apiName: '',
    displayName: {zh: '', en: ''},
    dataType: 'string',
    required: false,
  };
}

/** New empty precondition. */
export function newPreconditionForm(): PreconditionForm {
  return {key: rowKey(), exprText: '', message: {zh: '', en: ''}};
}

/** New empty impact hint. */
export function newImpactForm(): ImpactForm {
  return {key: rowKey(), property: '', change: '0'};
}

/** Action type definition → form. */
export function actionTypeToForm(d: ActionTypeDef): ActionTypeForm {
  return {
    kind: 'action-types',
    apiName: d.apiName,
    displayName: toPair(d.displayName),
    targetType: d.targetType,
    parameters: d.parameters.map(p => {
      const keep: ParamForm['keep'] = {};
      if (p.defaultValue !== undefined) keep.defaultValue = p.defaultValue;
      if (p.suggest !== undefined) keep.suggest = p.suggest;
      return {
        key: rowKey(),
        apiName: p.apiName,
        displayName: toPair(p.displayName),
        dataType: p.dataType,
        required: !!p.required,
        keep: Object.keys(keep).length ? keep : undefined,
      };
    }),
    preconditions: d.preconditions.map(pc => ({
      key: rowKey(),
      exprText: json(pc.expr),
      message: toPair(pc.message),
    })),
    effects: d.effects.map(effectToForm),
    impact: (d.impact ?? []).map(h => ({
      key: rowKey(),
      property: h.property,
      change: String(h.change),
    })),
    keep:
      d.description !== undefined ? {description: d.description} : undefined,
  };
}

/** Definition → form. */
export function defToForm(kind: DefKind, def: TypeDef): DefForm {
  if (kind === 'object-types') return objectTypeToForm(def as ObjectTypeDef);
  if (kind === 'link-types') return linkTypeToForm(def as LinkTypeDef);
  return actionTypeToForm(def as ActionTypeDef);
}

/** A new, empty form of a kind (defaults use the first object type). */
export function newForm(kind: DefKind, types: readonly string[]): DefForm {
  const first = types[0] ?? '';
  if (kind === 'object-types') {
    const id = newPropertyForm('id');
    id.required = true;
    id.indexed = true;
    id.displayName = {zh: '编号', en: 'ID'};
    return {
      kind,
      apiName: '',
      displayName: {zh: '', en: ''},
      icon: '',
      primaryKey: 'id',
      titleProperty: 'id',
      properties: [id],
    };
  }
  if (kind === 'link-types') {
    return {
      kind,
      apiName: '',
      displayName: {zh: '', en: ''},
      from: first,
      to: types[1] ?? first,
      cardinality: 'many',
      propagates: false,
      defaultWeight: '0.5',
    };
  }
  return {
    kind,
    apiName: '',
    displayName: {zh: '', en: ''},
    targetType: first,
    parameters: [],
    preconditions: [],
    effects: [],
    impact: [],
  };
}

// --- Validation ------------------------------------------------------------

/** Issue codes (translated as `ontology:issue.<code>`). */
export type IssueCode =
  | 'apiName'
  | 'required'
  | 'dataType'
  | 'range'
  | 'propertiesMin'
  | 'duplicate'
  | 'maxIndexed'
  | 'unknownProp'
  | 'unknownType'
  | 'unknownLink'
  | 'unknownParam'
  | 'enumValues'
  | 'idTaken'
  | 'json'
  | 'number'
  | 'invalid'
  | 'server';

/** A field-level issue; `path` is dotted (`properties.2.apiName`). */
export interface FieldIssue {
  path: string;
  code: IssueCode;
  /** Free text (zod / server message). */
  message?: string;
  params?: Record<string, string | number>;
}

/** Workspace context used by the cross-definition checks. */
export interface ValidationCtx {
  def: OntologyDef;
  /** True when creating (POST): the apiName must be free. */
  isNew: boolean;
}

/** Result of building a definition from a form. */
export interface BuildResult {
  def?: TypeDef;
  issues: FieldIssue[];
}

function parseJson(
  text: string,
  path: string,
  issues: FieldIssue[],
): JsonLogic | undefined {
  const s = text.trim();
  if (!s) {
    issues.push({path, code: 'required'});
    return undefined;
  }
  try {
    return JSON.parse(s) as JsonLogic;
  } catch {
    issues.push({path, code: 'json'});
    return undefined;
  }
}

function parseNumber(
  text: string,
  path: string,
  issues: FieldIssue[],
): number | undefined {
  const s = text.trim();
  const n = s === '' ? NaN : Number(s);
  if (!Number.isFinite(n)) {
    issues.push({path, code: 'number'});
    return undefined;
  }
  return n;
}

/** Object type form → definition (no validation). */
export function objectTypeFromForm(f: ObjectTypeForm): ObjectTypeDef {
  const def: ObjectTypeDef = {
    apiName: f.apiName.trim(),
    displayName: fromPair(f.displayName),
    primaryKey: f.primaryKey,
    titleProperty: f.titleProperty,
    properties: f.properties.map(p => {
      const out: PropertyDef = {
        apiName: p.apiName.trim(),
        displayName: fromPair(p.displayName),
        dataType: p.dataType as DataType,
      };
      if (p.required) out.required = true;
      if (p.unit.trim()) out.unit = p.unit.trim();
      if (p.indexed) out.indexed = true;
      if (p.semanticTags.length) out.semanticTags = [...p.semanticTags];
      if (p.sensitive) out.sensitive = true;
      if (p.dataType === 'enum') out.enumValues = [...p.enumValues];
      if (p.keep?.description !== undefined)
        out.description = p.keep.description;
      return out;
    }),
  };
  if (f.icon.trim()) def.icon = f.icon.trim();
  if (f.keep?.description !== undefined) def.description = f.keep.description;
  return def;
}

function linkTypeFromForm(f: LinkTypeForm, issues: FieldIssue[]): LinkTypeDef {
  const def: LinkTypeDef = {
    apiName: f.apiName.trim(),
    displayName: fromPair(f.displayName),
    from: f.from,
    to: f.to,
    cardinality: f.cardinality,
  };
  if (f.propagates) {
    const w = parseNumber(f.defaultWeight, 'propagation.defaultWeight', issues);
    def.propagation = {defaultWeight: w ?? 0};
  }
  return def;
}

function effectFromForm(
  e: EffectForm,
  i: number,
  issues: FieldIssue[],
): EffectDef {
  const path = `effects.${i}`;
  switch (e.kind) {
    case 'set':
      return {
        kind: 'set',
        prop: e.prop,
        value: parseJson(e.valueText, `${path}.value`, issues) ?? null,
      };
    case 'increment':
      return {
        kind: 'increment',
        prop: e.prop,
        by: parseJson(e.valueText, `${path}.by`, issues) ?? null,
      };
    case 'relink':
      return {
        kind: 'relink',
        link: e.link,
        direction: e.direction,
        toParam: e.toParam,
      };
    case 'unlink':
      return e.toParam
        ? {
            kind: 'unlink',
            link: e.link,
            direction: e.direction,
            toParam: e.toParam,
          }
        : {kind: 'unlink', link: e.link, direction: e.direction};
  }
}

function actionTypeFromForm(
  f: ActionTypeForm,
  issues: FieldIssue[],
): ActionTypeDef {
  const def: ActionTypeDef = {
    apiName: f.apiName.trim(),
    displayName: fromPair(f.displayName),
    targetType: f.targetType,
    parameters: f.parameters.map(p => {
      const out: ParamDef = {
        apiName: p.apiName.trim(),
        displayName: fromPair(p.displayName),
        dataType: p.dataType as DataType,
      };
      if (p.required) out.required = true;
      if (p.keep?.defaultValue !== undefined)
        out.defaultValue = p.keep.defaultValue;
      if (p.keep?.suggest !== undefined) out.suggest = p.keep.suggest;
      return out;
    }),
    preconditions: f.preconditions.map((pc, i) => ({
      expr: parseJson(pc.exprText, `preconditions.${i}.expr`, issues) ?? null,
      message: fromPair(pc.message),
    })),
    effects: f.effects.map((e, i) => effectFromForm(e, i, issues)),
  };
  if (f.impact.length) {
    def.impact = f.impact.map((h, i) => ({
      property: h.property,
      change: parseNumber(h.change, `impact.${i}.change`, issues) ?? 0,
    }));
  }
  if (f.keep?.description !== undefined) def.description = f.keep.description;
  return def;
}

/** Form → definition, collecting JSON / number parse issues. */
export function formToDef(f: DefForm): BuildResult {
  const issues: FieldIssue[] = [];
  let def: TypeDef;
  if (f.kind === 'object-types') def = objectTypeFromForm(f);
  else if (f.kind === 'link-types') def = linkTypeFromForm(f, issues);
  else def = actionTypeFromForm(f, issues);
  return {def, issues};
}

type ZodIssueLike = {path: PropertyKey[]; code: string; message: string};

/** Maps a zod issue to a field issue. */
export function fromZodIssue(i: ZodIssueLike): FieldIssue {
  const path = i.path.map(String).join('.');
  const last = String(i.path[i.path.length - 1] ?? '');
  if (last === 'apiName') return {path, code: 'apiName'};
  if (last === 'dataType') return {path, code: 'dataType'};
  if (path === 'properties' && i.code === 'too_small')
    return {path, code: 'propertiesMin'};
  if (i.code === 'too_small' || i.code === 'too_big')
    return {path, code: 'range'};
  if (i.code === 'invalid_type') return {path, code: 'required'};
  return {path, code: 'invalid', message: i.message};
}

function dupes(names: string[], prefix: string, issues: FieldIssue[]): void {
  const seen = new Set<string>();
  names.forEach((n, i) => {
    if (!n) return;
    if (seen.has(n))
      issues.push({path: `${prefix}.${i}.apiName`, code: 'duplicate'});
    seen.add(n);
  });
}

function needZh(text: I18nText, path: string, issues: FieldIssue[]): void {
  if (!resolveText(text, 'zh-CN').trim()) issues.push({path, code: 'required'});
}

function objectRefTarget(dataType: string): string | undefined {
  return dataType.startsWith('objectRef:')
    ? dataType.slice('objectRef:'.length)
    : undefined;
}

function checkObjectType(
  d: ObjectTypeDef,
  ctx: ValidationCtx,
  issues: FieldIssue[],
): void {
  const types = new Set([
    ...ctx.def.objectTypes.map(t => t.apiName),
    d.apiName,
  ]);
  needZh(d.displayName, 'displayName', issues);
  const names = d.properties.map(p => p.apiName);
  dupes(names, 'properties', issues);
  d.properties.forEach((p, i) => {
    needZh(p.displayName, `properties.${i}.displayName`, issues);
    if (p.dataType === 'enum' && !(p.enumValues ?? []).length)
      issues.push({path: `properties.${i}.enumValues`, code: 'enumValues'});
    const ref = objectRefTarget(p.dataType);
    if (ref && !types.has(ref))
      issues.push({
        path: `properties.${i}.dataType`,
        code: 'unknownType',
        params: {name: ref},
      });
  });
  const indexed = d.properties.filter(p => p.indexed).length;
  if (indexed > MAX_INDEXED_PROPS)
    issues.push({
      path: 'properties',
      code: 'maxIndexed',
      params: {max: MAX_INDEXED_PROPS, count: indexed},
    });
  if (!names.includes(d.primaryKey))
    issues.push({path: 'primaryKey', code: 'unknownProp'});
  if (!names.includes(d.titleProperty))
    issues.push({path: 'titleProperty', code: 'unknownProp'});
}

function checkLinkType(
  d: LinkTypeDef,
  ctx: ValidationCtx,
  issues: FieldIssue[],
): void {
  const types = new Set(ctx.def.objectTypes.map(t => t.apiName));
  needZh(d.displayName, 'displayName', issues);
  if (!types.has(d.from))
    issues.push({path: 'from', code: 'unknownType', params: {name: d.from}});
  if (!types.has(d.to))
    issues.push({path: 'to', code: 'unknownType', params: {name: d.to}});
}

function checkActionType(
  d: ActionTypeDef,
  ctx: ValidationCtx,
  issues: FieldIssue[],
): void {
  needZh(d.displayName, 'displayName', issues);
  const target = ctx.def.objectTypes.find(t => t.apiName === d.targetType);
  if (!target)
    issues.push({
      path: 'targetType',
      code: 'unknownType',
      params: {name: d.targetType},
    });
  const props = new Set(target?.properties.map(p => p.apiName) ?? []);
  const links = new Set(ctx.def.linkTypes.map(l => l.apiName));
  const params = new Set(d.parameters.map(p => p.apiName));
  dupes(
    d.parameters.map(p => p.apiName),
    'parameters',
    issues,
  );
  d.parameters.forEach((p, i) =>
    needZh(p.displayName, `parameters.${i}.displayName`, issues),
  );
  d.preconditions.forEach((pc, i) =>
    needZh(pc.message, `preconditions.${i}.message`, issues),
  );
  d.effects.forEach((e, i) => {
    if (e.kind === 'set' || e.kind === 'increment') {
      if (target && !props.has(e.prop))
        issues.push({path: `effects.${i}.prop`, code: 'unknownProp'});
    } else {
      if (!links.has(e.link))
        issues.push({path: `effects.${i}.link`, code: 'unknownLink'});
      if ((e.kind === 'relink' || e.toParam) && !params.has(e.toParam ?? ''))
        issues.push({path: `effects.${i}.toParam`, code: 'unknownParam'});
    }
  });
  (d.impact ?? []).forEach((h, i) => {
    if (target && !props.has(h.property))
      issues.push({path: `impact.${i}.property`, code: 'unknownProp'});
  });
}

const FIELD: Record<DefKind, 'objectTypes' | 'linkTypes' | 'actionTypes'> = {
  'object-types': 'objectTypes',
  'link-types': 'linkTypes',
  'action-types': 'actionTypes',
};

/** Definitions of a kind in an ontology. */
export function defsOf(def: OntologyDef, kind: DefKind): TypeDef[] {
  return (def[FIELD[kind]] ?? []) as TypeDef[];
}

/**
 * Builds and validates a definition: parse issues, the contract zod schema
 * (`defSchemas[kind]`) and the workbench rules. `def` is set only when
 * there are no issues.
 */
export function buildDef(f: DefForm, ctx: ValidationCtx): BuildResult {
  const {def, issues} = formToDef(f);
  if (!def) return {issues};
  const parsed = defSchemas[f.kind].safeParse(def);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const fi = fromZodIssue(i);
      if (!issues.some(x => x.path === fi.path)) issues.push(fi);
    }
  }
  if (
    ctx.isNew &&
    def.apiName &&
    defsOf(ctx.def, f.kind).some(d => d.apiName === def.apiName)
  )
    issues.push({path: 'apiName', code: 'idTaken'});
  const extra: FieldIssue[] = [];
  if (f.kind === 'object-types')
    checkObjectType(def as ObjectTypeDef, ctx, extra);
  else if (f.kind === 'link-types')
    checkLinkType(def as LinkTypeDef, ctx, extra);
  else checkActionType(def as ActionTypeDef, ctx, extra);
  for (const e of extra)
    if (!issues.some(x => x.path === e.path)) issues.push(e);
  return issues.length ? {issues} : {def, issues};
}

/**
 * Field issues from a 400/422 VALIDATION_FAILED Problem (`extras.errors` =
 * `[{path, message}]`); empty for other errors.
 */
export function serverIssues(err: unknown): FieldIssue[] {
  if (!isApiError(err, 'VALIDATION_FAILED')) return [];
  const list = err.extras.errors;
  if (!Array.isArray(list) || list.length === 0)
    return [{path: '', code: 'server', message: err.detail}];
  return list.map(e => {
    const r = (e ?? {}) as {path?: unknown; message?: unknown};
    return {
      path: typeof r.path === 'string' ? r.path : '',
      code: 'server' as const,
      message: typeof r.message === 'string' ? r.message : undefined,
    };
  });
}

/** Issues keyed by path (first wins). */
export function issuesByPath(
  issues: readonly FieldIssue[],
): Map<string, FieldIssue> {
  const m = new Map<string, FieldIssue>();
  for (const i of issues) if (!m.has(i.path)) m.set(i.path, i);
  return m;
}

/**
 * The ontology after a successful save (`def`) or delete (`def` null) of
 * definition `id`, with the new schema etag; the workspace now has its own
 * copy. Used to update the query cache before the refetch completes.
 */
export function withDefinition(
  o: OntologyDto,
  kind: DefKind,
  id: string,
  def: TypeDef | null,
  etag: number,
): OntologyDto {
  const list = defsOf(o.definition, kind);
  const i = list.findIndex(d => d.apiName === id);
  let next: TypeDef[];
  if (def === null) next = list.filter(d => d.apiName !== id);
  else if (i >= 0) next = list.map((d, j) => (j === i ? def : d));
  else next = [...list, def];
  return {
    ...o,
    etag,
    custom: true,
    definition: {...o.definition, [FIELD[kind]]: next},
  };
}

// --- References / graph ----------------------------------------------------

/** Definitions that reference an object type (blocking its deletion). */
export interface TypeReferences {
  links: string[];
  actions: string[];
  /** `Type.prop` of objectRef properties pointing at the type. */
  properties: string[];
}

/** Collects the references to an object type from other definitions. */
export function referencesTo(def: OntologyDef, type: string): TypeReferences {
  return {
    links: def.linkTypes
      .filter(l => l.from === type || l.to === type)
      .map(l => l.apiName),
    actions: def.actionTypes
      .filter(a => a.targetType === type)
      .map(a => a.apiName),
    properties: def.objectTypes
      .filter(t => t.apiName !== type)
      .flatMap(t =>
        t.properties
          .filter(p => objectRefTarget(p.dataType) === type)
          .map(p => `${t.apiName}.${p.apiName}`),
      ),
  };
}

/** Schema graph: object types as nodes, link types as edges. */
export function schemaGraph(
  def: OntologyDef,
  locale: string,
): {nodes: GNode[]; edges: GEdge[]} {
  const names = new Set(def.objectTypes.map(t => t.apiName));
  return {
    nodes: def.objectTypes.map(t => ({
      id: t.apiName,
      label: resolveText(t.displayName, locale, t.apiName),
      type: t.apiName,
    })),
    edges: def.linkTypes
      .filter(l => names.has(l.from) && names.has(l.to))
      .map(l => ({
        id: l.apiName,
        source: l.from,
        target: l.to,
        type: l.apiName,
        label: resolveText(l.displayName, locale, l.apiName),
        weight: l.propagation?.defaultWeight ?? null,
      })),
  };
}
