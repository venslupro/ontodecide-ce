/**
 * @fileoverview Object-graph view model (pure): URL filter/sort params,
 * ontology-driven columns, graph slices → graph view elements, action
 * availability from preconditions, action parameter defaults and
 * validation, merge-patch construction, provenance and the unified object
 * timeline (property changes, alerts, recommendations, actions).
 */

import type {RecommendationDto} from '@ontodecide/decision/contract';
import type {
  ActionLogDto,
  GraphSlice,
  MergePatch,
  ObjectDto,
} from '@ontodecide/object-graph/contract';
import {
  evalLogic,
  filterExprSchema,
  type FilterExpr,
  type OrderBy,
  type Provenance,
} from '@ontodecide/shared-kernel';
import type {AlertDto} from '@ontodecide/situation/contract';
import type {
  UiActionType,
  UiObjectType,
  UiParam,
  UiProperty,
} from '../../entities/schema/model';
import {orderedProperties} from '../../entities/schema/model';
import type {GEdge, GNode} from '../../shared/graph/limit';

// --- List ------------------------------------------------------------------

/** Parses the `filter` search param (JSON FilterExpr); invalid → undefined. */
export function parseFilterParam(raw: unknown): FilterExpr | undefined {
  if (typeof raw !== 'string' || !raw) {
    if (raw && typeof raw === 'object') {
      const r = filterExprSchema.safeParse(raw);
      return r.success ? r.data : undefined;
    }
    return undefined;
  }
  try {
    const r = filterExprSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** Serializes a filter for the URL. */
export function filterParam(expr: FilterExpr | undefined): string | undefined {
  return expr ? JSON.stringify(expr) : undefined;
}

/** Parses `prop:dir`. */
export function parseOrderBy(raw: unknown): OrderBy | undefined {
  if (typeof raw !== 'string') return undefined;
  const [prop, dir] = raw.split(':');
  if (!prop || (dir !== 'asc' && dir !== 'desc')) return undefined;
  return {prop, dir};
}

/** Next sort state when a column header is clicked: asc → desc → none. */
export function nextSort(
  current: OrderBy | undefined,
  prop: string,
): OrderBy | undefined {
  if (!current || current.prop !== prop) return {prop, dir: 'asc'};
  if (current.dir === 'asc') return {prop, dir: 'desc'};
  return undefined;
}

/** Only indexed properties are sorted/filtered in D1. */
export function isSortable(p: UiProperty): boolean {
  return p.indexed;
}

/** Table columns from the ontology (title and primary key first). */
export function resolveColumns(t: UiObjectType, max = 10): UiProperty[] {
  return orderedProperties(t).slice(0, max);
}

/** Row count above which the table is virtualized. */
export const VIRTUALIZE_ABOVE = 100;

// --- Graph -----------------------------------------------------------------

/** Converts a GraphSlice into graph view nodes/edges. */
export function sliceToGraph(
  slice: GraphSlice | undefined,
  rootRid?: string,
): {nodes: GNode[]; edges: GEdge[]} {
  if (!slice) return {nodes: [], edges: []};
  return {
    nodes: slice.nodes.map(n => ({
      id: n.rid,
      label: n.title,
      type: n.type,
      hop: n.hop,
      root: n.rid === rootRid || (rootRid === undefined && n.hop === 0),
    })),
    edges: slice.edges.map(e => ({
      id: `${e.type}:${e.src}:${e.dst}`,
      source: e.src,
      target: e.dst,
      type: e.type,
      weight: e.weight,
    })),
  };
}

/** Filters a slice to the given link types (empty = all), keeping reachable nodes. */
export function filterSlice(
  slice: GraphSlice | undefined,
  linkTypes: readonly string[],
): GraphSlice | undefined {
  if (!slice || linkTypes.length === 0) return slice;
  const edges = slice.edges.filter(e => linkTypes.includes(e.type));
  const keep = new Set<string>();
  for (const n of slice.nodes) if (n.hop === 0) keep.add(n.rid);
  for (const e of edges) {
    keep.add(e.src);
    keep.add(e.dst);
  }
  return {...slice, edges, nodes: slice.nodes.filter(n => keep.has(n.rid))};
}

/** Types present in a slice, in first-seen order (legend). */
export function sliceTypes(slice: GraphSlice | undefined): string[] {
  return [...new Set((slice?.nodes ?? []).map(n => n.type))];
}

// --- Actions ---------------------------------------------------------------

/** Default parameter values of an action. */
export function paramDefaults(a: UiActionType): Record<string, unknown> {
  return Object.fromEntries(
    a.parameters.map(p => [p.apiName, p.defaultValue ?? null]),
  );
}

/**
 * Evaluates the preconditions against the object (and default params).
 * Returns the unmet messages; an expression that cannot be evaluated
 * locally is left to the server.
 */
export function unmetPreconditions(
  a: UiActionType,
  obj: Pick<ObjectDto, 'props'>,
  params: Record<string, unknown> = paramDefaults(a),
): string[] {
  const data = {target: obj.props, params};
  return a.preconditions.flatMap(pc => {
    try {
      return evalLogic(pc.expr, data) ? [] : [pc.message];
    } catch {
      return [];
    }
  });
}

/** Actions of the object's type whose preconditions are satisfied. */
export function availableActions(
  t: UiObjectType | undefined,
  obj: Pick<ObjectDto, 'props'> | undefined,
): UiActionType[] {
  if (!t || !obj) return [];
  return t.actions.filter(a => unmetPreconditions(a, obj).length === 0);
}

function emptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** Missing required parameters (api names). */
export function missingParams(
  params: readonly UiParam[],
  values: Record<string, unknown>,
): string[] {
  return params
    .filter(p => p.required && emptyValue(values[p.apiName]))
    .map(p => p.apiName);
}

/** Drops empty optional parameters. */
export function cleanParams(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => !emptyValue(v)),
  );
}

// --- Edit ------------------------------------------------------------------

/**
 * RFC 7396 merge patch between the stored and the edited properties:
 * changed values are set, cleared values become `null`.
 */
export function buildMergePatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): MergePatch {
  const patch: MergePatch = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = after[k];
    const b = before[k];
    if (emptyValue(a)) {
      if (!emptyValue(b)) patch[k] = null;
    } else if (JSON.stringify(a) !== JSON.stringify(b)) patch[k] = a;
  }
  return patch;
}

// --- Provenance & timeline -------------------------------------------------

/** Provenance of one property, if the value came from an import. */
export function provenanceOf(
  obj: Pick<ObjectDto, 'provenance'>,
  prop: string,
): Provenance | undefined {
  return obj.provenance?.[prop];
}

/** Unified timeline entry. */
export type TimelineEntry =
  | {kind: 'import'; at: number; prop: string; jobId: string; row: number}
  | {kind: 'action'; at: number; log: ActionLogDto}
  | {kind: 'alert'; at: number; alert: AlertDto}
  | {
      kind: 'recommendation';
      at: number;
      rec: Pick<RecommendationDto, 'id' | 'summary' | 'status' | 'rankedBy'>;
    };

/** Builds the timeline (newest first, ≤ `max`). */
export function buildTimeline(input: {
  object?: Pick<ObjectDto, 'provenance'>;
  actions?: readonly ActionLogDto[];
  alerts?: readonly AlertDto[];
  recommendations?: readonly Pick<
    RecommendationDto,
    'id' | 'summary' | 'status' | 'rankedBy' | 'createdAt'
  >[];
  max?: number;
}): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const [prop, p] of Object.entries(input.object?.provenance ?? {}))
    out.push({kind: 'import', at: p.at, prop, jobId: p.jobId, row: p.row});
  for (const log of input.actions ?? [])
    out.push({kind: 'action', at: Date.parse(log.executedAt), log});
  for (const alert of input.alerts ?? [])
    out.push({kind: 'alert', at: Date.parse(alert.raisedAt), alert});
  for (const rec of input.recommendations ?? [])
    out.push({kind: 'recommendation', at: Date.parse(rec.createdAt), rec});
  return out
    .filter(e => Number.isFinite(e.at))
    .sort((a, b) => b.at - a.at)
    .slice(0, input.max ?? 30);
}

/** Changed properties of an action (before → after). */
export function actionChanges(
  log: Pick<ActionLogDto, 'before' | 'after'>,
): {prop: string; before: unknown; after: unknown}[] {
  const keys = new Set([...Object.keys(log.before), ...Object.keys(log.after)]);
  return [...keys]
    .filter(k => JSON.stringify(log.before[k]) !== JSON.stringify(log.after[k]))
    .map(k => ({prop: k, before: log.before[k], after: log.after[k]}));
}
