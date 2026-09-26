/**
 * @fileoverview Ports of the ObjectGraph application layer. Infrastructure
 * provides the implementations (D1, queues, Neo4j, webhooks).
 */

import type {
  IntegrationRpc,
  WriteResult,
} from '@ontodecide/integration/contract';
import type {CompiledModel} from '@ontodecide/ontology/contract';
import type {
  CallCtx,
  Clock,
  FilterExpr,
  Logger,
  OrderBy,
  Rid,
} from '@ontodecide/shared-kernel';
import type {
  ActionLogDto,
  GraphSyncMsg,
  MergeSuggestionDto,
  ObjectSetDto,
  ObjectSummary,
  SituationEventMsg,
  WritebackStatus,
} from '../contract';
import type {
  AggregateFn,
  FuzzyCandidate,
  StoredLink,
  StoredObject,
} from '../domain';

/** Supplies the tenant's compiled ontology model. */
export interface ModelProvider {
  /**
   * Returns the active model. A cached model is reused when its version
   * equals `expectedVersion` (or, without one, while it is fresh).
   */
  get(
    ctx: CallCtx,
    opts?: {expectedVersion?: string; refresh?: boolean},
  ): Promise<CompiledModel>;
}

/** Query over one object type; filters/orders use indexed properties only. */
export interface ObjectQuery {
  type: string;
  filter?: FilterExpr;
  orderBy?: OrderBy[];
  offset: number;
  limit: number;
}

/** Read access to objects and links. Every method is tenant scoped. */
export interface ObjectReader {
  getByRid(tenantId: string, rid: Rid): Promise<StoredObject | null>;
  getByRids(tenantId: string, rids: readonly Rid[]): Promise<StoredObject[]>;
  /** Resolves `(type, primaryKey)` pairs with one query. */
  getByKeys(
    tenantId: string,
    keys: readonly {type: string; primaryKey: string}[],
  ): Promise<StoredObject[]>;
  findAliases(
    tenantId: string,
    keys: readonly {sourceId: string; externalKey: string}[],
  ): Promise<{sourceId: string; externalKey: string; rid: Rid}[]>;
  /** Objects of a type whose title starts with the bucket character (≤ limit). */
  fuzzyCandidates(
    tenantId: string,
    type: string,
    bucket: string,
    limit: number,
  ): Promise<FuzzyCandidate[]>;
  query(tenantId: string, q: ObjectQuery): Promise<StoredObject[]>;
  count(tenantId: string, type: string, filter?: FilterExpr): Promise<number>;
  /** RIDs matching an indexed filter (≤ limit). */
  queryRids(
    tenantId: string,
    type: string,
    filter: FilterExpr | undefined,
    limit: number,
  ): Promise<Rid[]>;
  /** SQL aggregate over an indexed numeric property. */
  aggregateIndexed(
    tenantId: string,
    type: string,
    filter: FilterExpr | undefined,
    prop: string,
    fn: Exclude<AggregateFn, 'count'>,
  ): Promise<number>;
  links(
    tenantId: string,
    rids: readonly Rid[],
    opts: {direction: 'out' | 'in' | 'both'; linkTypes?: readonly string[]},
  ): Promise<StoredLink[]>;
  summaries(
    tenantId: string,
    rids: readonly Rid[],
  ): Promise<(ObjectSummary & {primaryKey: string})[]>;
  search(
    tenantId: string,
    q: string,
    type: string | undefined,
    limit: number,
  ): Promise<StoredObject[]>;
  /** Pages through the objects of the given types ordered by RID. */
  pageByTypes(
    tenantId: string,
    types: readonly string[],
    afterRid: string,
    limit: number,
  ): Promise<StoredObject[]>;
  /** Pages through links whose type is in `linkTypes`, ordered by key. */
  pageLinks(
    tenantId: string,
    linkTypes: readonly string[],
    after: {type: string; src: string; dst: string} | null,
    limit: number,
  ): Promise<StoredLink[]>;
}

/** Outbox event (one row in domain_event). */
export type OutboxEvent =
  | {
      id: string;
      tenantId: string;
      type: string;
      topic: 'situation-events';
      payload: SituationEventMsg;
      occurredAt: number;
    }
  | {
      id: string;
      tenantId: string;
      type: 'GraphSync';
      topic: 'graph-sync';
      payload: GraphSyncMsg;
      occurredAt: number;
    };

/** Stored action log entry. */
export interface ActionLogRecord extends ActionLogDto {
  tenantId: string;
  writebackAttempts: number;
}

/** One write of a unit of work (committed atomically). */
export type WriteOp =
  | {kind: 'insertObject'; obj: StoredObject}
  | {kind: 'updateObject'; obj: StoredObject}
  | {kind: 'deleteObject'; tenantId: string; rid: Rid}
  /** Aborts the whole commit (VERSION_CONFLICT) unless the version matches. */
  | {kind: 'guardVersion'; tenantId: string; rid: Rid; version: number}
  /** Upserts one og_prop_index row; a null value deletes it. */
  | {
      kind: 'setIndex';
      tenantId: string;
      type: string;
      rid: Rid;
      prop: string;
      value: unknown;
    }
  | {kind: 'clearIndex'; tenantId: string; rid: Rid}
  | {kind: 'clearIndexProp'; tenantId: string; type: string; prop: string}
  | {kind: 'upsertLink'; tenantId: string; link: StoredLink}
  | {kind: 'deleteLink'; tenantId: string; link: StoredLink}
  | {kind: 'moveLinks'; tenantId: string; from: Rid; to: Rid}
  | {
      kind: 'alias';
      tenantId: string;
      sourceId: string;
      externalKey: string;
      rid: Rid;
      /** Repoint an existing alias (merge accept); otherwise keep it. */
      replace?: boolean;
    }
  | {
      kind: 'mergeSuggestion';
      tenantId: string;
      id: string;
      ridA: Rid;
      ridB: Rid;
      score: number;
      createdAt: number;
    }
  | {
      kind: 'resolveSuggestion';
      tenantId: string;
      id: string;
      status: 'ACCEPTED' | 'REJECTED';
    }
  | {kind: 'actionLog'; entry: ActionLogRecord}
  | {kind: 'outbox'; event: OutboxEvent}
  | {
      kind: 'inbox';
      tenantId: string;
      key: string;
      result: WriteResult;
      at: number;
    }
  | {kind: 'meta'; tenantId: string; key: string; value: string};

/** Commits a unit of work in one atomic batch. */
export interface ObjectWriter {
  /**
   * Commits all ops atomically. Throws VERSION_CONFLICT when a guard fails
   * and CONFLICT (`extras.duplicate = 'inbox'`) for a duplicate inbox key.
   */
  commit(ops: readonly WriteOp[]): Promise<void>;
}

/** Outbox dispatch (queue delivery of committed events). */
export interface Outbox {
  /** Sends events to their queues and marks them dispatched. */
  dispatch(events: readonly OutboxEvent[], now: Date): Promise<void>;
  /** Re-sends events still undispatched and older than `olderThan` (ms). */
  redispatchPending(
    olderThan: number,
    now: Date,
    limit?: number,
  ): Promise<number>;
  /** Deletes dispatched events older than `before` (ms). */
  purgeDispatched(before: number): Promise<number>;
  /** Sends graph-sync messages directly (projection rebuild). */
  publishGraphSync(msgs: readonly GraphSyncMsg[]): Promise<void>;
}

/** Traversal result (nodes with hop distance, edges between them). */
export interface TraversalResult {
  nodes: {rid: Rid; hop: number}[];
  edges: StoredLink[];
}

/** Graph traversal (D1 or Neo4j). */
export interface GraphTraversal {
  /** Outgoing traversal from the roots. */
  impact(
    tenantId: string,
    q: {
      rids: readonly Rid[];
      linkTypes?: readonly string[];
      maxHops: number;
      limit: number;
    },
  ): Promise<TraversalResult>;
  /** Paths between two objects, edges walkable in both directions. */
  paths(
    tenantId: string,
    from: Rid,
    to: Rid,
    maxHops: number,
  ): Promise<Rid[][]>;
}

/** Writes the Neo4j projection. */
export interface GraphProjection {
  readonly enabled: boolean;
  sync(msg: GraphSyncMsg): Promise<void>;
  heartbeat(at: Date): Promise<void>;
}

/** Delivers executed actions to external systems. */
export interface WritebackPort {
  /** Throws when delivery fails. */
  send(req: {
    url: string;
    body: unknown;
    idempotencyKey: string;
  }): Promise<void>;
}

/** Action log storage (reads and writeback status updates). */
export interface ActionLogRepository {
  findByRecommendation(
    tenantId: string,
    recommendationId: string,
    actionType: string,
    target: Rid,
  ): Promise<ActionLogRecord | null>;
  list(
    tenantId: string,
    filter: {rid?: Rid; limit: number},
  ): Promise<ActionLogRecord[]>;
  setWriteback(
    tenantId: string,
    id: string,
    status: WritebackStatus,
    attempts: number,
  ): Promise<void>;
  /** System scan (all tenants): pending writebacks below the attempt cap. */
  pendingWritebacks(
    maxAttempts: number,
    limit: number,
  ): Promise<ActionLogRecord[]>;
}

/** Merge suggestion storage. */
export interface MergeSuggestionRepository {
  list(tenantId: string, limit: number): Promise<MergeSuggestionDto[]>;
  get(tenantId: string, id: string): Promise<MergeSuggestionDto | null>;
}

/** Saved object set storage. */
export interface ObjectSetRepository {
  list(tenantId: string): Promise<ObjectSetDto[]>;
  get(tenantId: string, id: string): Promise<ObjectSetDto | null>;
  save(tenantId: string, dto: ObjectSetDto): Promise<void>;
}

/** Stored idempotency record of an object-writes message. */
export interface InboxRecord {
  tenantId: string;
  result: WriteResult;
  reportedAt: number | null;
}

/** Per-tenant metadata and the message inbox. */
export interface MetaRepository {
  get(tenantId: string, key: string): Promise<string | null>;
  set(tenantId: string, key: string, value: string): Promise<void>;
  getInbox(tenantId: string, key: string): Promise<InboxRecord | null>;
  markReported(tenantId: string, key: string, at: number): Promise<void>;
  /** System maintenance: deletes inbox rows older than `before` (ms). */
  purgeInbox(before: number): Promise<number>;
}

/** Everything the use cases need. */
export interface AppDeps {
  reader: ObjectReader;
  writer: ObjectWriter;
  outbox: Outbox;
  d1Traversal: GraphTraversal;
  /** Present when the Neo4j projection is enabled. */
  neo4jTraversal?: GraphTraversal;
  projection: GraphProjection;
  writeback: WritebackPort;
  models: ModelProvider;
  integration: Pick<IntegrationRpc, 'reportWriteResult'>;
  actionLogs: ActionLogRepository;
  suggestions: MergeSuggestionRepository;
  objectSets: ObjectSetRepository;
  meta: MetaRepository;
  clock: Clock;
  logger: Logger;
  approvalSecret: string;
}
