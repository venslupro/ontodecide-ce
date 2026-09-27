/**
 * @fileoverview Ports of the object-graph application layer (详细设计 6.11.3:
 * ObjectWriter, ObjectReader, GraphTraversal; plus the action log, outbox,
 * ontology and event publisher). D1 implementations live in
 * infrastructure/.
 */

import type {
  CallCtx,
  Clock,
  DomainEventMsg,
  FilterExpr,
  Logger,
  Rid,
} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '@ontodecide/ontology/contract';
import type {ActionLogDto, ActionResult, GraphStats} from '../contract/types';
import type {
  GraphCaps,
  GraphCounts,
  PlannedLink,
  PlannedObject,
  PropState,
  SortPlan,
  StoredLink,
  StoredObject,
  WalkHit,
} from '../domain';

/** Compiled ontology of the caller's workspace. */
export interface SchemaProvider {
  get(ctx: CallCtx): Promise<CompiledSchema>;
}

/** Sends a domain event (split into ≤ 64 KB messages). */
export interface EventPublisher {
  publish(msg: DomainEventMsg): Promise<void>;
}

/** An outbox row written in the same batch as the business rows. */
export interface OutboxRow {
  id: string;
  msg: DomainEventMsg;
}

/** Index row of an object. */
export interface IndexRow {
  prop: string;
  value: string | number;
}

/** A planned object with its hash and index rows. */
export interface HashedObject extends PlannedObject {
  hash: string;
  index: IndexRow[];
}

/** What a committed upsert actually wrote. */
export interface UpsertCommit {
  /** Rids inserted or updated. */
  objects: Set<string>;
  /** Link keys inserted or updated (see linkKey). */
  links: Set<string>;
}

/** An update of one object guarded by its version. */
export interface GuardedUpdate {
  rid: Rid;
  expectedVersion: number;
  state: PropState;
  title: string;
  hash: string;
  /** Replacement index rows, or null to keep the current ones. */
  index: IndexRow[] | null;
  nowMs: number;
}

/** An action log row. */
export interface ActionLogRow {
  id: string;
  actionType: string;
  targetRid: Rid;
  params: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actor: string;
  actorUserId: string | null;
  recommendationId: string | null;
  idempotencyKey: string;
  result: Omit<ActionResult, 'replayed'>;
  executedAt: number;
}

/** Outcome of a guarded commit. */
export type CommitOutcome = 'ok' | 'stale' | 'duplicate';

/** Object reads (workspace-scoped). */
export interface ObjectReader {
  /** Object/link totals and whether the workspace is tombstoned. */
  counts(): Promise<GraphCounts & {tombstoned: boolean}>;
  /** Objects by (type, primary key), one query. */
  findByKeys(
    keys: {type: string; primaryKey: string}[],
  ): Promise<StoredObject[]>;
  get(rid: Rid): Promise<StoredObject | null>;
  getMany(rids: Rid[]): Promise<StoredObject[]>;
  /**
   * Objects of an optional type matching free text and an indexed filter,
   * ordered by `sort`; `limit` null returns every match.
   */
  query(spec: {
    type?: string;
    q?: string;
    pushdown?: FilterExpr;
    sort: SortPlan;
    offset: number;
    limit: number | null;
  }): Promise<StoredObject[]>;
  stats(): Promise<GraphStats>;
}

/** Object writes (workspace-scoped); each call is one D1 batch. */
export interface ObjectWriter {
  commitUpsert(input: {
    objects: HashedObject[];
    links: PlannedLink[];
    caps: GraphCaps;
    outbox: OutboxRow | null;
    nowMs: number;
  }): Promise<UpsertCommit>;
  commitPatch(update: GuardedUpdate, outbox: OutboxRow): Promise<CommitOutcome>;
  commitAction(input: {
    update: GuardedUpdate;
    removeLinks: StoredLink[];
    addLinks: StoredLink[];
    log: ActionLogRow;
    outbox: OutboxRow;
  }): Promise<CommitOutcome>;
}

/** Link traversal (workspace-scoped). */
export interface GraphTraversal {
  /** Links from the given sources. */
  linksFrom(rids: Rid[]): Promise<StoredLink[]>;
  /** Links of one object in both directions, restricted to link types. */
  linksOf(rid: Rid, types: string[]): Promise<StoredLink[]>;
  /** Recursive walk around one object; returns ≤ `limit` hits by hop. */
  walk(q: {
    rid: Rid;
    depth: 1 | 2;
    direction: 'out' | 'in' | 'both';
    types?: string[];
    limit: number;
  }): Promise<WalkHit[]>;
  /** Outgoing impact walk (6.3.2); returns ≤ `limit` hits by hop. */
  impactWalk(q: {
    rids: Rid[];
    types: string[];
    depth: 1 | 2;
    limit: number;
  }): Promise<WalkHit[]>;
  /** Links whose two ends are both in `rids`. */
  edgesAmong(rids: string[], types?: string[]): Promise<StoredLink[]>;
}

/** Action log reads (workspace-scoped). */
export interface ActionLogReader {
  findByKey(key: string): Promise<{
    actionType: string;
    targetRid: string;
    result: Omit<ActionResult, 'replayed'>;
  } | null>;
  listForTarget(
    rid: Rid,
    after: {at: number; id: string} | null,
    limit: number,
  ): Promise<ActionLogDto[]>;
}

/** Outbox cleanup after delivery (workspace-scoped). */
export interface OutboxStore {
  delete(id: string): Promise<void>;
}

/** Repositories of one workspace. */
export interface TenantRepos {
  reader: ObjectReader;
  writer: ObjectWriter;
  traversal: GraphTraversal;
  actions: ActionLogReader;
  outbox: OutboxStore;
}

/** An undelivered outbox row (any workspace). */
export interface PendingEvent {
  tid: string;
  id: string;
  msg: DomainEventMsg;
}

/** Cross-workspace outbox maintenance (cron only; SystemRepository). */
export interface OutboxRelayStore {
  oldest(olderThanMs: number, limit: number): Promise<PendingEvent[]>;
  delete(tid: string, id: string): Promise<void>;
  isTombstoned(tid: string): Promise<boolean>;
  sweepTombstones(nowMs: number): Promise<void>;
}

/** A JSON Lines file exported by object-graph. */
export type GraphExportFile = 'objects.jsonl' | 'links.jsonl' | 'audit.jsonl';

/** Tenant lifecycle storage (lifecycle entry point only; SystemRepository). */
export interface LifecycleStore {
  /** Rows of a file after `after` (keyset), in key order, as JSON records. */
  exportRows(
    tid: string,
    file: GraphExportFile,
    after: string[] | null,
    limit: number,
  ): Promise<{key: string[]; record: unknown}[]>;
  /** Deletes ≤ maxRows rows in purge order; `remaining` false when empty. */
  purgeStep(
    tid: string,
    maxRows: number,
  ): Promise<{deleted: number; remaining: boolean}>;
  count(tid: string): Promise<number>;
  /**
   * Object and link counts of several workspaces (one grouped COUNT per
   * table); workspaces without rows are absent from the result.
   */
  stats(
    tids: string[],
  ): Promise<Record<string, {objects: number; links: number}>>;
  writeTombstone(tid: string, nowMs: number): Promise<void>;
}

/** Dependencies shared by the use cases. */
export interface GraphDeps {
  repos(tid: string): TenantRepos;
  schema: SchemaProvider;
  publisher: EventPublisher;
  clock: Clock;
  logger: Logger;
  caps: GraphCaps;
}
