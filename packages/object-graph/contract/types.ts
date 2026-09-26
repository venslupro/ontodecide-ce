/**
 * @fileoverview Object graph DTOs and queue messages.
 */

import type {
  FilterExpr,
  ObjectSetDef,
  PageResult,
  Provenance,
  Rid,
  UsageResource,
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
  weight?: number | null;
  /** Relative to the object the link was loaded for. */
  direction: 'out' | 'in';
}

/** Object with properties filtered by the caller's markings. */
export interface ObjectDto {
  rid: Rid;
  type: string;
  primaryKey: string;
  title: string;
  props: Record<string, unknown>;
  provenance: Record<string, Provenance>;
  version: number;
  schemaVersion: string;
  updatedAt: string;
  /** Properties hidden because the caller lacks their markings. */
  hiddenProps?: string[];
  links?: LinkDto[];
  /** Objects reachable through `links` (depth ≤ 2). */
  neighbors?: ObjectSummary[];
}

/** Page of objects. */
export type ObjectPage = PageResult<ObjectDto>;

/** Graph node used by traversals and the simulator. */
export interface GraphNode {
  rid: Rid;
  type: string;
  title: string;
  props: Record<string, unknown>;
  /** Hop distance from the query roots. */
  hop?: number;
}

/** Graph edge. */
export interface GraphEdge {
  type: string;
  src: Rid;
  dst: Rid;
  weight?: number | null;
}

/** A subgraph. */
export interface GraphSlice {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Impact subgraph query (outgoing traversal). */
export interface ImpactQuery {
  rids: Rid[];
  /** Empty or omitted = every link type. */
  linkTypes?: string[];
  maxHops: 1 | 2 | 3;
  /** ≤ 500. */
  limit: number;
}

/** Approval voucher signed by decision-engine; verified by object-graph. */
export interface ApprovalVoucher {
  recommendationId: string;
  tenantId: string;
  actionType: string;
  target: Rid;
  expiresAt: string;
  signature: string;
}

/** Command to execute an action. */
export interface ApplyActionCmd {
  actionType: string;
  target: Rid;
  params: Record<string, unknown>;
  recommendationId?: string;
  approval?: ApprovalVoucher;
  /** Expected object version (If-Match). */
  ifMatch?: number;
}

/** Writeback state of an executed action. */
export type WritebackStatus = 'NONE' | 'SENT' | 'WRITEBACK_PENDING';

/** Outcome of an action. */
export interface ActionResult {
  actionLogId: string;
  actionType: string;
  rid: Rid;
  version: number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  writebackStatus: WritebackStatus;
  executedAt: string;
}

/** Audit entry for an executed action. */
export interface ActionLogDto {
  id: string;
  actionType: string;
  targetRid: Rid;
  params: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actor: string;
  recommendationId?: string;
  writebackStatus: WritebackStatus;
  executedAt: string;
}

/** Property lineage: current provenance and overwritten history (≤ 5). */
export interface LineageDto {
  rid: Rid;
  props: Record<
    string,
    {
      value: unknown;
      current: Provenance | null;
      history: (Provenance & {value: unknown})[];
    }
  >;
}

/** Saved Object Set. */
export interface ObjectSetDto {
  id: string;
  name: string;
  definition: ObjectSetDef;
  createdBy: string;
  updatedAt: string;
}

/** Fuzzy entity-resolution merge suggestion. */
export interface MergeSuggestionDto {
  id: string;
  ridA: Rid;
  ridB: Rid;
  titleA: string;
  titleB: string;
  score: number;
  status: 'OPEN' | 'ACCEPTED' | 'REJECTED';
  createdAt: string;
}

/** Aggregation over an Object Set (KPI computation). */
export interface AggregateQuery {
  objectSet: ObjectSetDef;
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  prop?: string;
}

/** List query for one object type. */
export interface ListObjectsQuery {
  filter?: FilterExpr;
  orderBy?: {prop: string; dir: 'asc' | 'desc'}[];
  cursor?: string;
  limit?: number;
}

/** Message on the `graph-sync` queue (self-consumed by object-graph). */
export interface GraphSyncMsg {
  tenantId: string;
  upserts: {
    rid: Rid;
    type: string;
    title: string;
    idx: Record<string, unknown>;
  }[];
  links: {
    type: string;
    src: Rid;
    dst: Rid;
    weight?: number | null;
    op: 'merge' | 'delete';
  }[];
}

/** One changed object in a situation event. */
export interface ObjectChange {
  rid: Rid;
  type: string;
  title: string;
  changed: string[];
  after: Record<string, unknown>;
}

/** Message on the `situation-events` queue (one per write batch). */
export interface SituationEventMsg {
  eventId: string;
  tenantId: string;
  kind: 'ObjectsUpserted' | 'ActionExecuted' | 'JobFinished';
  occurredAt: string;
  correlationId: string;
  changes: ObjectChange[];
  /** For ActionExecuted. */
  action?: {actionLogId: string; actionType: string; recommendationId?: string};
  /** For JobFinished. */
  job?: {jobId: string};
  /** Free-tier usage caused by the write (recorded by UsageGuard). */
  usage?: {resource: UsageResource; n: number}[];
}

/** Traversal limits. */
export const GRAPH_LIMITS = {
  d1MaxHops: 2,
  neo4jMaxHops: 3,
  subgraphNodesDefault: 200,
  subgraphNodesMax: 500,
  neo4jTimeoutMs: 2000,
  provenanceHistoryMax: 5,
  fuzzyCandidatesMax: 200,
  fuzzyThreshold: 0.92,
} as const;
