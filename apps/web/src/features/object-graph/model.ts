/**
 * @fileoverview Object graph view models: URL param parsing, column models,
 * risk levels, dynamic action-parameter schemas, graph conversions (object
 * neighborhoods, traversal slices, paths) and the unified object timeline.
 * Pure functions only — no React, no translations.
 */

import type {RecommendationDto} from '@ontodecide/decision/contract';
import type {
  ActionLogDto,
  GraphSlice,
  ObjectDto,
  ObjectSummary,
} from '@ontodecide/object-graph/contract';
import type {FilterExpr, OrderBy, Rid} from '@ontodecide/shared-kernel';
import type {AlertDto} from '@ontodecide/situation/contract';
import {z} from 'zod';
import {rendererKey} from '../../entities/renderers/registry';
import {
  orderedProperties,
  type UiLinkType,
  type UiObjectType,
  type UiParam,
  type UiProperty,
} from '../../entities/schema/model';
import type {GEdge, GNode} from '../../shared/graph/limit';
import {isApiError} from '../../shared/api/errors';

// ----------------------------------------------------------------------------
// URL params
// ----------------------------------------------------------------------------

/** Parses the `filter=<json FilterExpr>` search param (invalid → undefined). */
export function parseFilterParam(
  raw: string | undefined,
): FilterExpr | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && 'op' in v
      ? (v as FilterExpr)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Serializes a FilterExpr for the URL (undefined when empty). */
export function filterParam(expr: FilterExpr | undefined): string | undefined {
  return expr ? JSON.stringify(expr) : undefined;
}

/** Cycles a header's sort state: none → asc → desc → none. */
export function nextSort(
  current: OrderBy | undefined,
  prop: string,
): OrderBy | undefined {
  if (!current || current.prop !== prop) return {prop, dir: 'asc'};
  if (current.dir === 'asc') return {prop, dir: 'desc'};
  return undefined;
}

// ----------------------------------------------------------------------------
// Columns
// ----------------------------------------------------------------------------

/** Whether a property can be sorted server-side (indexed and visible). */
export function isSortable(p: UiProperty): boolean {
  return p.indexed && p.visible;
}

/** Default column width (px) for a property in the object table. */
export function columnWidth(p: UiProperty, isTitle: boolean): number {
  if (isTitle) return 240;
  switch (rendererKey(p.dataType)) {
    case 'integer':
    case 'double':
      return 140;
    case 'boolean':
      return 100;
    case 'enum':
      return 130;
    case 'date':
      return 130;
    case 'timestamp':
      return 180;
    case 'geopoint':
      return 180;
    case 'objectRef':
      return 170;
    default:
      return 180;
  }
}

/**
 * Resolves the visible columns of a type: the persisted choice (unknown
 * names dropped, schema order kept) or every property. The title column is
 * always included.
 */
export function resolveColumns(
  t: UiObjectType,
  persisted: readonly string[] | undefined,
): UiProperty[] {
  const all = orderedProperties(t);
  if (!persisted || persisted.length === 0) return all;
  const keep = new Set([...persisted, t.titleProperty]);
  const cols = all.filter(p => keep.has(p.apiName));
  return cols.length ? cols : all;
}

// ----------------------------------------------------------------------------
// Risk
// ----------------------------------------------------------------------------

/** Risk level of a 0–100 score: ≥ 70 crit, ≥ 40 warn, otherwise good. */
export function riskLevel(v: unknown): 'good' | 'warn' | 'crit' | null {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v)
        : NaN;
  if (!Number.isFinite(n)) return null;
  if (n >= 70) return 'crit';
  if (n >= 40) return 'warn';
  return 'good';
}

// ----------------------------------------------------------------------------
// Action parameters
// ----------------------------------------------------------------------------

/** Messages used by the dynamic action-parameter schema. */
export interface ParamSchemaMessages {
  required: string;
  number: string;
  integer: string;
}

function isBlank(v: unknown): boolean {
  return (
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  );
}

/**
 * Builds a zod schema for action parameters: required params must be
 * non-empty; numeric params must be (integer) numbers.
 */
export function paramsSchema(
  params: readonly UiParam[],
  msg: ParamSchemaMessages,
) {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const p of params) {
    const key = rendererKey(p.dataType);
    shape[p.apiName] = z.unknown().superRefine((v, ctx) => {
      if (isBlank(v)) {
        if (p.required) ctx.addIssue({code: 'custom', message: msg.required});
        return;
      }
      if (key === 'integer' || key === 'double') {
        if (typeof v !== 'number' || !Number.isFinite(v))
          ctx.addIssue({code: 'custom', message: msg.number});
        else if (key === 'integer' && !Number.isInteger(v))
          ctx.addIssue({code: 'custom', message: msg.integer});
      }
    });
  }
  return z.object(shape);
}

/** Default form values from the parameters' `defaultValue`s. */
export function paramDefaults(
  params: readonly UiParam[],
): Record<string, unknown> {
  return Object.fromEntries(
    params.map(p => [
      p.apiName,
      p.defaultValue ?? (rendererKey(p.dataType) === 'boolean' ? false : null),
    ]),
  );
}

/** Drops blank values before sending parameters to the server. */
export function cleanParams(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => !isBlank(v)),
  );
}

/** Classified action error (table 8). */
export type ActionErrorView =
  | {kind: 'approval'; code: string; recommendationId?: string}
  | {kind: 'conflict'}
  | {kind: 'precondition'; unmet: string[]}
  | {kind: 'other'; error: unknown};

/** Classifies an error thrown by an action execution. */
export function classifyActionError(err: unknown): ActionErrorView {
  if (isApiError(err, 'APPROVAL_REQUIRED', 'INVALID_TRANSITION')) {
    const id = err.extras.recommendationId;
    return {
      kind: 'approval',
      code: err.code,
      recommendationId: typeof id === 'string' && id ? id : undefined,
    };
  }
  if (isApiError(err, 'VERSION_CONFLICT')) return {kind: 'conflict'};
  if (isApiError(err, 'PRECONDITION_FAILED')) {
    const raw = err.extras.unmet;
    const unmet = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
    return {
      kind: 'precondition',
      unmet: unmet.length ? unmet : err.detail ? [err.detail] : [],
    };
  }
  return {kind: 'other', error: err};
}

// ----------------------------------------------------------------------------
// Graph conversions
// ----------------------------------------------------------------------------

/** Display name lookup for link types. */
export function linkLabels(
  links: readonly UiLinkType[],
): Record<string, string> {
  return Object.fromEntries(links.map(l => [l.apiName, l.displayName]));
}

/** A graph ready for {@link GraphView}. */
export interface GraphData {
  nodes: GNode[];
  edges: GEdge[];
}

/** Empty graph. */
export const EMPTY_GRAPH: GraphData = {nodes: [], edges: []};

function edgeId(type: string, src: string, dst: string): string {
  return `${type}:${src}->${dst}`;
}

/** Converts an object with `links` + `neighbors` into a graph rooted at it. */
export function objectToGraph(
  o: ObjectDto,
  labels: Record<string, string> = {},
): GraphData {
  const nodes = new Map<string, GNode>();
  nodes.set(o.rid, {
    id: o.rid,
    label: o.title,
    type: o.type,
    root: true,
    hop: 0,
  });
  for (const n of o.neighbors ?? []) {
    if (!nodes.has(n.rid))
      nodes.set(n.rid, {id: n.rid, label: n.title, type: n.type, hop: 1});
  }
  const edges = new Map<string, GEdge>();
  for (const l of o.links ?? []) {
    const id = edgeId(l.type, l.src, l.dst);
    if (!edges.has(id))
      edges.set(id, {
        id,
        source: l.src,
        target: l.dst,
        type: l.type,
        label: labels[l.type] ?? l.type,
        weight: l.weight,
      });
  }
  // Link endpoints not listed in `neighbors` still need a node.
  for (const e of edges.values()) {
    for (const r of [e.source, e.target]) {
      if (!nodes.has(r))
        nodes.set(r, {
          id: r,
          label: shortRid(r),
          type: typeOfRid(r) ?? '?',
          hop: 1,
        });
    }
  }
  return {nodes: [...nodes.values()], edges: [...edges.values()]};
}

/** Merges graphs (first occurrence wins; `root` is kept from the base). */
export function mergeGraphs(base: GraphData, ...more: GraphData[]): GraphData {
  const nodes = new Map(base.nodes.map(n => [n.id, n] as const));
  const edges = new Map(
    base.edges.map(
      e => [e.id ?? edgeId(e.type, e.source, e.target), e] as const,
    ),
  );
  for (const g of more) {
    for (const n of g.nodes)
      if (!nodes.has(n.id)) nodes.set(n.id, {...n, root: false});
    for (const e of g.edges) {
      const id = e.id ?? edgeId(e.type, e.source, e.target);
      if (!edges.has(id)) edges.set(id, e);
    }
  }
  return {nodes: [...nodes.values()], edges: [...edges.values()]};
}

/** Keeps only edges of the allowed link types (empty = all) and drops orphans except roots. */
export function filterByLinkTypes(
  g: GraphData,
  allowed: readonly string[],
): GraphData {
  if (allowed.length === 0) return g;
  const set = new Set(allowed);
  const edges = g.edges.filter(e => set.has(e.type));
  const used = new Set(edges.flatMap(e => [e.source, e.target]));
  return {nodes: g.nodes.filter(n => n.root || used.has(n.id)), edges};
}

/** Converts an impact slice into a graph with intensity by hop. */
export function impactToGraph(
  s: GraphSlice,
  root: string | undefined,
  maxHops: number,
  labels: Record<string, string> = {},
): GraphData {
  const nodes: GNode[] = s.nodes.map(n => {
    const hop = n.rid === root ? 0 : (n.hop ?? maxHops);
    const delta = Math.abs(
      Number((n.props as Record<string, unknown> | undefined)?.delta ?? NaN),
    );
    const byHop = 1 - hop / (maxHops + 1);
    const impact = Number.isFinite(delta)
      ? Math.max(byHop, Math.min(1, delta))
      : byHop;
    return {
      id: n.rid,
      label: n.title,
      type: n.type,
      hop,
      impact,
      score: impact,
      root: n.rid === root,
    };
  });
  const ids = new Set(nodes.map(n => n.id));
  const edges: GEdge[] = s.edges
    .filter(e => ids.has(e.src) && ids.has(e.dst))
    .map(e => ({
      id: edgeId(e.type, e.src, e.dst),
      source: e.src,
      target: e.dst,
      type: e.type,
      label: labels[e.type] ?? e.type,
      weight: e.weight,
    }));
  return {nodes, edges};
}

/**
 * Converts paths (RID chains) into a graph; nodes on the highlighted path
 * get full intensity, the endpoints are marked as roots.
 */
export function pathsToGraph(
  paths: readonly Rid[][],
  titles: Record<string, string>,
  highlight = 0,
): GraphData {
  const on = new Set(paths[highlight] ?? []);
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  for (const p of paths) {
    p.forEach((r, i) => {
      if (!nodes.has(r)) {
        nodes.set(r, {
          id: r,
          label: titles[r] ?? shortRid(r),
          type: typeOfRid(r) ?? '?',
          hop: i,
          impact: on.has(r) ? 1 : 0.2,
          root: i === 0 || i === p.length - 1,
        });
      }
      if (i > 0) {
        const id = edgeId('path', p[i - 1], r);
        if (!edges.has(id))
          edges.set(id, {id, source: p[i - 1], target: r, type: 'path'});
      }
    });
  }
  return {nodes: [...nodes.values()], edges: [...edges.values()]};
}

/** Object type encoded in a RID (`ri.<tenant>.<Type>.<id>`). */
export function typeOfRid(rid: string): string | undefined {
  const parts = rid.split('.');
  return parts.length >= 4 ? parts[2] : undefined;
}

/** Short RID for compact display. */
export function shortRid(rid: string): string {
  const parts = rid.split('.');
  return parts.length >= 4 ? `${parts[2]}·${parts.slice(3).join('.')}` : rid;
}

/** Neighbors grouped by link type and direction (accessible graph fallback). */
export interface NeighborGroup {
  linkType: string;
  direction: 'out' | 'in';
  items: ObjectSummary[];
}

/** Groups the direct neighbors of an object by link type. */
export function groupNeighbors(o: ObjectDto): NeighborGroup[] {
  const byRid = new Map((o.neighbors ?? []).map(n => [n.rid, n] as const));
  const groups = new Map<string, NeighborGroup>();
  for (const l of o.links ?? []) {
    const isOut = l.src === o.rid;
    if (!isOut && l.dst !== o.rid) continue;
    const other = isOut ? l.dst : l.src;
    const key = `${l.type}:${isOut ? 'out' : 'in'}`;
    const g = groups.get(key) ?? {
      linkType: l.type,
      direction: isOut ? 'out' : 'in',
      items: [],
    };
    if (!g.items.some(i => i.rid === other)) {
      g.items.push(
        byRid.get(other) ?? {
          rid: other,
          type: typeOfRid(other) ?? '?',
          title: shortRid(other),
        },
      );
    }
    groups.set(key, g);
  }
  return [...groups.values()];
}

// ----------------------------------------------------------------------------
// Timeline
// ----------------------------------------------------------------------------

/** One entry of the unified object timeline. */
export type TimelineEntry =
  | {kind: 'action'; id: string; at: string; log: ActionLogDto}
  | {kind: 'alert'; id: string; at: string; alert: AlertDto}
  | {kind: 'recommendation'; id: string; at: string; rec: RecommendationDto}
  | {kind: 'update'; id: string; at: string; version: number};

/** Builds the timeline (newest first). */
export function buildTimeline(input: {
  object?: Pick<ObjectDto, 'rid' | 'updatedAt' | 'version'>;
  actions?: readonly ActionLogDto[];
  alerts?: readonly AlertDto[];
  recommendations?: readonly RecommendationDto[];
}): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  if (input.object)
    out.push({
      kind: 'update',
      id: `u:${input.object.rid}`,
      at: input.object.updatedAt,
      version: input.object.version,
    });
  for (const log of input.actions ?? [])
    out.push({kind: 'action', id: `a:${log.id}`, at: log.executedAt, log});
  for (const alert of input.alerts ?? [])
    out.push({kind: 'alert', id: `al:${alert.id}`, at: alert.raisedAt, alert});
  for (const rec of input.recommendations ?? [])
    out.push({
      kind: 'recommendation',
      id: `r:${rec.id}`,
      at: rec.createdAt,
      rec,
    });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
