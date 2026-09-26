/**
 * @fileoverview Ontology workbench model: an editable {@link SchemaDef} held
 * in a reducer (selection by index so renames keep the form mounted),
 * normalization / cleanup for save, pack file validation and the schema →
 * relation-graph projection.
 */

import {
  schemaDefSchema,
  type ActionTypeDef,
  type LinkTypeDef,
  type ObjectTypeDef,
  type OntologyPack,
  type PropertyDef,
  type SchemaDef,
  type SimulationKpiDef,
} from '@ontodecide/ontology/contract';
import type {I18nText} from '@ontodecide/shared-kernel';
import type {GEdge, GNode} from '../../shared/graph/limit';

/** Api name rule shared with the contract schemas. */
export const API_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Editable text map used by the forms (always both locales). */
export type I18nMap = {'zh-CN': string; 'en-US': string};

/** Tree sections of the workbench. */
export type SectionKind = 'object' | 'link' | 'action' | 'kpi';

/** Current selection (index-based so renaming keeps the editor mounted). */
export type Selection = {kind: 'schema'} | {kind: SectionKind; index: number};

/** Workbench state. */
export interface WorkbenchState {
  def: SchemaDef;
  selection: Selection;
  dirty: boolean;
  /** True when the schema does not exist on the server yet. */
  isNew: boolean;
  /** Stored draft/current version (display only). */
  version?: string;
}

/** Reducer actions. */
export type WorkbenchAction =
  | {
      type: 'load';
      def: SchemaDef;
      isNew: boolean;
      version?: string;
      dirty?: boolean;
    }
  | {type: 'select'; selection: Selection}
  | {type: 'updateSchemaMeta'; displayName: I18nText; description?: I18nText}
  | {type: 'updateObject'; index: number; value: ObjectTypeDef}
  | {type: 'updateLink'; index: number; value: LinkTypeDef}
  | {type: 'updateAction'; index: number; value: ActionTypeDef}
  | {type: 'updateKpi'; index: number; value: SimulationKpiDef}
  | {type: 'add'; kind: SectionKind}
  | {type: 'remove'; kind: SectionKind; index: number}
  | {type: 'saved'; version?: string; def?: SchemaDef};

/** Converts any I18nText to a two-locale map. */
export function toI18nMap(text: I18nText | undefined): I18nMap {
  if (text === undefined) return {'zh-CN': '', 'en-US': ''};
  if (typeof text === 'string') return {'zh-CN': text, 'en-US': text};
  return {'zh-CN': text['zh-CN'] ?? '', 'en-US': text['en-US'] ?? ''};
}

/** Drops empty locales; returns undefined when both are empty. */
export function compactI18n(text: I18nText | undefined): I18nText | undefined {
  if (text === undefined) return undefined;
  if (typeof text === 'string') return text.trim() ? text : undefined;
  const out: Partial<I18nMap> = {};
  for (const [k, v] of Object.entries(text))
    if (v && v.trim()) out[k as keyof I18nMap] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Returns a fresh empty schema. */
export function emptySchema(
  apiName: string,
  displayName?: I18nText,
): SchemaDef {
  return {
    apiName,
    displayName: displayName ?? {'zh-CN': apiName, 'en-US': apiName},
    objectTypes: [],
    linkTypes: [],
    actionTypes: [],
    functions: [],
    simulationKpis: [],
  };
}

function normProp(p: PropertyDef): PropertyDef {
  return {...p, displayName: toI18nMap(p.displayName)};
}

/** Normalizes display texts to maps so the forms can bind to both locales. */
export function normalizeSchema(def: SchemaDef): SchemaDef {
  return {
    ...def,
    displayName: toI18nMap(def.displayName),
    objectTypes: def.objectTypes.map(o => ({
      ...o,
      displayName: toI18nMap(o.displayName),
      properties: o.properties.map(normProp),
    })),
    linkTypes: def.linkTypes.map(l => ({
      ...l,
      displayName: toI18nMap(l.displayName),
    })),
    actionTypes: def.actionTypes.map(a => ({
      ...a,
      displayName: toI18nMap(a.displayName),
      parameters: a.parameters.map(p => ({
        ...p,
        displayName: toI18nMap(p.displayName),
      })),
      preconditions: a.preconditions.map(c => ({
        ...c,
        message: toI18nMap(c.message),
      })),
    })),
    functions: def.functions ?? [],
    simulationKpis: (def.simulationKpis ?? []).map(k => ({
      ...k,
      displayName: toI18nMap(k.displayName),
    })),
  };
}

function opt<T>(v: T | '' | null | undefined): T | undefined {
  if (v === '' || v === null || v === undefined) return undefined;
  return v;
}

function optList(v: string[] | undefined): string[] | undefined {
  const list = (v ?? []).map(s => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

function stripUndefined<T extends object>(o: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

function cleanProp(p: PropertyDef): PropertyDef {
  return stripUndefined({
    ...p,
    displayName: compactI18n(p.displayName) ?? p.apiName,
    description: compactI18n(p.description),
    unit: opt(p.unit?.trim()),
    required: p.required || undefined,
    indexed: p.indexed || undefined,
    sensitive: p.sensitive || undefined,
    markings: optList(p.markings),
    semanticTags: optList(p.semanticTags),
    enumValues: p.dataType === 'enum' ? optList(p.enumValues) : undefined,
  });
}

/** Removes empty optional values before sending the schema to the server. */
export function cleanSchema(def: SchemaDef): SchemaDef {
  return stripUndefined({
    ...def,
    displayName: compactI18n(def.displayName) ?? def.apiName,
    description: compactI18n(def.description),
    objectTypes: def.objectTypes.map(o =>
      stripUndefined({
        ...o,
        displayName: compactI18n(o.displayName) ?? o.apiName,
        description: compactI18n(o.description),
        icon: opt(o.icon?.trim()),
        graphProjected: o.graphProjected || undefined,
        properties: o.properties.map(cleanProp),
      }),
    ),
    linkTypes: def.linkTypes.map(l =>
      stripUndefined({
        ...l,
        displayName: compactI18n(l.displayName) ?? l.apiName,
        propagation:
          l.propagation && Number.isFinite(l.propagation.defaultWeight)
            ? {defaultWeight: l.propagation.defaultWeight}
            : undefined,
      }),
    ),
    actionTypes: def.actionTypes.map(a =>
      stripUndefined({
        ...a,
        displayName: compactI18n(a.displayName) ?? a.apiName,
        description: compactI18n(a.description),
        parameters: a.parameters.map(p =>
          stripUndefined({
            ...p,
            displayName: compactI18n(p.displayName) ?? p.apiName,
            required: p.required || undefined,
            defaultValue: opt(p.defaultValue as unknown),
          }),
        ),
        preconditions: a.preconditions.map(c => ({
          ...c,
          message: compactI18n(c.message) ?? '',
        })),
        impact: a.impact?.length ? a.impact : undefined,
        writeback: a.writeback,
      }),
    ),
    simulationKpis: (def.simulationKpis ?? []).map(k =>
      stripUndefined({
        ...k,
        displayName: compactI18n(k.displayName) ?? k.apiName,
        property: k.agg === 'count' ? undefined : opt(k.property),
        unit: opt(k.unit?.trim()),
      }),
    ),
  });
}

function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++)
    if (!taken.includes(`${base}${i}`)) return `${base}${i}`;
}

/** New object type with a primary key property. */
export function newObjectType(taken: readonly string[]): ObjectTypeDef {
  return {
    apiName: uniqueName('NewType', taken),
    displayName: {'zh-CN': '', 'en-US': ''},
    primaryKey: 'id',
    titleProperty: 'id',
    graphProjected: true,
    properties: [
      {
        apiName: 'id',
        displayName: {'zh-CN': '编号', 'en-US': 'ID'},
        dataType: 'string',
        required: true,
      },
    ],
  };
}

/** New empty property. */
export function newProperty(taken: readonly string[]): PropertyDef {
  return {
    apiName: uniqueName('newProperty', taken),
    displayName: {'zh-CN': '', 'en-US': ''},
    dataType: 'string',
  };
}

function newLink(def: SchemaDef): LinkTypeDef {
  const first = def.objectTypes[0]?.apiName ?? '';
  const second = def.objectTypes[1]?.apiName ?? first;
  return {
    apiName: uniqueName(
      'newLink',
      def.linkTypes.map(l => l.apiName),
    ),
    displayName: {'zh-CN': '', 'en-US': ''},
    from: first,
    to: second,
    cardinality: 'many',
  };
}

function newAction(def: SchemaDef): ActionTypeDef {
  return {
    apiName: uniqueName(
      'newAction',
      def.actionTypes.map(a => a.apiName),
    ),
    displayName: {'zh-CN': '', 'en-US': ''},
    targetType: def.objectTypes[0]?.apiName ?? '',
    parameters: [],
    preconditions: [],
    effects: [],
    requiresApproval: true,
    writeback: {kind: 'none'},
  };
}

function newKpi(def: SchemaDef): SimulationKpiDef {
  return {
    apiName: uniqueName(
      'newKpi',
      (def.simulationKpis ?? []).map(k => k.apiName),
    ),
    displayName: {'zh-CN': '', 'en-US': ''},
    objectType: def.objectTypes[0]?.apiName ?? '',
    agg: 'count',
    higherIsBetter: true,
  };
}

/** Renames an object type everywhere it is referenced. */
export function renameObjectType(
  def: SchemaDef,
  from: string,
  to: string,
): SchemaDef {
  if (!from || from === to) return def;
  const ref = (s: string) => (s === from ? to : s);
  const refType = (dt: string) =>
    dt === `objectRef:${from}` ? `objectRef:${to}` : dt;
  return {
    ...def,
    objectTypes: def.objectTypes.map(o => ({
      ...o,
      properties: o.properties.map(p => ({
        ...p,
        dataType: refType(p.dataType) as PropertyDef['dataType'],
      })),
    })),
    linkTypes: def.linkTypes.map(l => ({
      ...l,
      from: ref(l.from),
      to: ref(l.to),
    })),
    actionTypes: def.actionTypes.map(a => ({
      ...a,
      targetType: ref(a.targetType),
      parameters: a.parameters.map(p => ({
        ...p,
        dataType: refType(p.dataType) as PropertyDef['dataType'],
        suggest: p.suggest
          ? {...p.suggest, objectType: ref(p.suggest.objectType)}
          : undefined,
      })),
    })),
    simulationKpis: (def.simulationKpis ?? []).map(k => ({
      ...k,
      objectType: ref(k.objectType),
    })),
  };
}

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((x, i) => (i === index ? value : x));
}

const LIST_KEY = {
  object: 'objectTypes',
  link: 'linkTypes',
  action: 'actionTypes',
  kpi: 'simulationKpis',
} as const;

/** Items of a section. */
export function sectionItems(
  def: SchemaDef,
  kind: SectionKind,
): {apiName: string; displayName: I18nText}[] {
  return (def[LIST_KEY[kind]] ?? []) as {
    apiName: string;
    displayName: I18nText;
  }[];
}

/** Workbench reducer. */
export function workbenchReducer(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  const edit = (
    def: SchemaDef,
    selection = state.selection,
  ): WorkbenchState => ({
    ...state,
    def,
    selection,
    dirty: true,
  });
  const {def} = state;
  switch (action.type) {
    case 'load': {
      const d = normalizeSchema(action.def);
      return {
        def: d,
        isNew: action.isNew,
        version: action.version,
        dirty: !!action.dirty,
        selection: d.objectTypes.length
          ? {kind: 'object', index: 0}
          : {kind: 'schema'},
      };
    }
    case 'select':
      return {...state, selection: action.selection};
    case 'updateSchemaMeta':
      return edit({
        ...def,
        displayName: action.displayName,
        description: action.description,
      });
    case 'updateObject': {
      const prev = def.objectTypes[action.index];
      let next: SchemaDef = {
        ...def,
        objectTypes: replaceAt(def.objectTypes, action.index, action.value),
      };
      const renamed = prev && prev.apiName !== action.value.apiName;
      const unique =
        renamed &&
        !def.objectTypes.some(
          (o, i) => i !== action.index && o.apiName === prev.apiName,
        );
      if (renamed && unique)
        next = renameObjectType(next, prev.apiName, action.value.apiName);
      return edit(next);
    }
    case 'updateLink':
      return edit({
        ...def,
        linkTypes: replaceAt(def.linkTypes, action.index, action.value),
      });
    case 'updateAction':
      return edit({
        ...def,
        actionTypes: replaceAt(def.actionTypes, action.index, action.value),
      });
    case 'updateKpi':
      return edit({
        ...def,
        simulationKpis: replaceAt(
          def.simulationKpis ?? [],
          action.index,
          action.value,
        ),
      });
    case 'add': {
      switch (action.kind) {
        case 'object': {
          const list = [
            ...def.objectTypes,
            newObjectType(def.objectTypes.map(o => o.apiName)),
          ];
          return edit(
            {...def, objectTypes: list},
            {kind: 'object', index: list.length - 1},
          );
        }
        case 'link': {
          const list = [...def.linkTypes, newLink(def)];
          return edit(
            {...def, linkTypes: list},
            {kind: 'link', index: list.length - 1},
          );
        }
        case 'action': {
          const list = [...def.actionTypes, newAction(def)];
          return edit(
            {...def, actionTypes: list},
            {kind: 'action', index: list.length - 1},
          );
        }
        case 'kpi': {
          const list = [...(def.simulationKpis ?? []), newKpi(def)];
          return edit(
            {...def, simulationKpis: list},
            {kind: 'kpi', index: list.length - 1},
          );
        }
      }
      return state;
    }
    case 'remove': {
      const key = LIST_KEY[action.kind];
      const list = ((def[key] ?? []) as unknown[]).filter(
        (_, i) => i !== action.index,
      );
      const sel = state.selection;
      let selection: Selection = sel;
      if (sel.kind === action.kind) {
        if (sel.index === action.index)
          selection = list.length
            ? {kind: action.kind, index: Math.min(sel.index, list.length - 1)}
            : {kind: 'schema'};
        else if (sel.index > action.index)
          selection = {kind: action.kind, index: sel.index - 1};
      }
      return edit({...def, [key]: list} as SchemaDef, selection);
    }
    case 'saved':
      return {
        ...state,
        // Edits made while the save was in flight keep the state dirty.
        dirty: action.def && action.def !== state.def ? state.dirty : false,
        isNew: false,
        version: action.version ?? state.version,
      };
  }
  return state;
}

/** Initial (loading) state. */
export function initialWorkbench(apiName: string): WorkbenchState {
  return {
    def: emptySchema(apiName),
    selection: {kind: 'schema'},
    dirty: false,
    isNew: false,
  };
}

/** Relation graph of a schema: object types as nodes, link types as edges. */
export function schemaGraph(
  def: SchemaDef,
  label: (t: I18nText | undefined, fb: string) => string,
) {
  const names = new Set(def.objectTypes.map(o => o.apiName));
  const nodes: GNode[] = def.objectTypes.map(o => ({
    id: o.apiName,
    label: label(o.displayName, o.apiName),
    type: o.apiName,
  }));
  const edges: GEdge[] = def.linkTypes
    .filter(l => names.has(l.from) && names.has(l.to))
    .map(l => ({
      id: `link:${l.apiName}`,
      source: l.from,
      target: l.to,
      type: l.apiName,
      label: label(l.displayName, l.apiName),
    }));
  return {nodes, edges};
}

/** Result of reading a pack file. */
export type PackParseResult =
  {ok: true; pack: OntologyPack} | {ok: false; issues: string[]};

/** Validates the shape of an uploaded pack (JSON text). */
export function parsePackFile(text: string): PackParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {ok: false, issues: [`JSON: ${(e as Error).message}`]};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return {ok: false, issues: ['(root): object expected']};
  const obj = raw as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof obj.id !== 'string' || !obj.id) issues.push('id: string required');
  if (typeof obj.version !== 'string' || !obj.version)
    issues.push('version: string required');
  if (obj.name === undefined) issues.push('name: required');
  const parsed = schemaDefSchema.safeParse(obj.schema);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 20)) {
      issues.push(
        `schema.${i.path.map(String).join('.') || '(root)'}: ${i.message}`,
      );
    }
  }
  if (issues.length) return {ok: false, issues};
  return {ok: true, pack: obj as unknown as OntologyPack};
}

const pendingNew = new Map<string, SchemaDef>();

/** Stashes a schema created in the "new ontology" dialog for the workbench. */
export function stashNewSchema(def: SchemaDef): void {
  pendingNew.set(def.apiName, def);
}

/** Takes (and removes) a stashed new schema. */
export function takeNewSchema(apiName: string): SchemaDef | undefined {
  const d = pendingNew.get(apiName);
  pendingNew.delete(apiName);
  return d;
}

/** Scalar data types offered in the type selects. */
export const SCALAR_DATA_TYPES = [
  'string',
  'integer',
  'double',
  'boolean',
  'date',
  'timestamp',
  'geopoint',
  'enum',
] as const;

/** Downloads a JSON value as a file via a Blob URL. */
export function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
