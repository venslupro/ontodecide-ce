/**
 * @fileoverview Object graph DTOs (详细设计 6.2, 6.11.3). object-graph is the
 * authority for objects and links and the only producer of domain events.
 */

import type {
  FilterExpr,
  OrderBy,
  PageResult,
  Provenance,
  Rid,
} from '@ontodecide/shared-kernel';

/** Minimal object reference. */
export interface ObjectSummary {
  rid: Rid;
  type: string;
  title: string;
}

/** A link as seen from one object. */
export interface LinkDto {
  type: string;
  src: Rid;
  dst: Rid;
  weight: number | null;
  /** Relative to the object the link was loaded for. */
  direction: 'out' | 'in';
}

/** An object. HTTP responses carry `version` as ETag `"v{version}"`. */
export interface ObjectDto {
  rid: Rid;
  type: string;
  primaryKey: string;
  title: string;
  props: Record<string, unknown>;
  /** Per property: the import job and row it came from. */
  provenance: Record<string, Provenance>;
  version: number;
  updatedAt: string;
  /** Properties whose stored value no longer matches the ontology type. */
  invalidProps?: string[];
  /**
   * Values of the ontology's declarative functions bound to this object type
   * (JSONLogic over `props`), keyed by function apiName. Null when a function
   * fails to evaluate.
   */
  derived?: Record<string, unknown>;
  /** `GET /objects/{rid}?expand=links&depth=` only (api-gateway BFF). */
  links?: GraphSlice;
}

/** Page of objects. */
export type ObjectPage = PageResult<ObjectDto>;

/** Object list query. Only indexed properties are pushed down to D1. */
export interface ObjectQuery {
  type?: string;
  /** Free text on title / primary key / RID. */
  q?: string;
  filter?: FilterExpr;
  orderBy?: OrderBy;
}

/** Graph node used by link views and the simulator. */
export interface GraphNode {
  rid: Rid;
  type: string;
  title: string;
  props: Record<string, unknown>;
  /** Hop distance from the query roots. */
  hop: number;
}

/** Graph edge. */
export interface GraphEdge {
  type: string;
  src: Rid;
  dst: Rid;
  weight: number | null;
}

/** A subgraph. */
export interface GraphSlice {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True when `limit` cut the result. */
  truncated: boolean;
}

/** Links of an object (GET /objects/{rid}/links). */
export interface LinksQuery {
  depth: 1 | 2;
  /** Empty = every link type. */
  linkTypes?: string[];
  direction?: 'out' | 'in' | 'both';
  /** ≤ 300. */
  limit?: number;
}

/** Outgoing impact traversal used by the simulator (recursive CTE). */
export interface ImpactQuery {
  rids: Rid[];
  /** Link types with propagation configured. */
  linkTypes: string[];
  depth: 1 | 2;
  /** ≤ 300. */
  limit: number;
}

/** Object and link counts of a workspace. */
export interface GraphStats {
  objects: number;
  links: number;
  byType: Record<string, number>;
}

/** One object write coming from an import batch (already mapped). */
export interface UpsertCmd {
  type: string;
  primaryKey: string;
  props: Record<string, unknown>;
  /** Source row number (for provenance and rejects). */
  row: number;
  /** Links from this object, resolved by target primary key. */
  links?: {type: string; toType: string; toKey: string; weight?: number}[];
}

/** Result of one upsertBatch call. */
export interface WriteResult {
  upserted: number;
  /** Unchanged rows (props_hash equal): not written. */
  skipped: number;
  linksWritten: number;
  rejected: {row: number; code: WriteRejectCode; detail?: string}[];
}

/** Why a row (or a link of it) was rejected by object-graph. */
export type WriteRejectCode =
  'OBJECT_LIMIT' | 'LINK_LIMIT' | 'REF_MISSING' | 'UNKNOWN_TYPE' | 'VALIDATION';

/** RFC 7396 merge patch of object properties. */
export type MergePatch = Record<string, unknown>;

/** Command to execute an action. */
export interface ApplyActionCmd {
  actionType: string;
  target: Rid;
  params: Record<string, unknown>;
  /** Expected object version (If-Match); required for human callers. */
  ifMatch?: number;
  idempotencyKey: string;
  recommendationId?: string;
}

/** Outcome of an action (also returned for an idempotent replay). */
export interface ActionResult {
  actionLogId: string;
  actionType: string;
  rid: Rid;
  version: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  executedAt: string;
  replayed: boolean;
}

/** Audit entry for an executed action (exported as audit.jsonl). */
export interface ActionLogDto {
  id: string;
  actionType: string;
  targetRid: Rid;
  params: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** `owner`, `admin` (Act-as) or `svc:decision-engine`. */
  actor: string;
  actorUserId?: string;
  recommendationId?: string;
  executedAt: string;
}

/** Traversal and write limits. */
export const GRAPH_LIMITS = {
  maxDepth: 2,
  subgraphNodesDefault: 200,
  subgraphNodesMax: 300,
  batchMax: 100,
} as const;
