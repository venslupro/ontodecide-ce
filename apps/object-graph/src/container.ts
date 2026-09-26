/**
 * @fileoverview Composition root of object-graph: binds the application
 * ports to D1, Queues, Neo4j and webhook adapters.
 */

import type {
  AppDeps,
  MaintenanceReport,
} from '@ontodecide/object-graph/application';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import {
  D1ActionLogRepository,
  D1GraphTraversal,
  D1MergeSuggestionRepository,
  D1MetaRepository,
  D1ObjectReader,
  D1ObjectSetRepository,
  D1ObjectWriter,
  Neo4jClient,
  Neo4jGraphTraversal,
  Neo4jProjection,
  OntologyModelProvider,
  QueueOutbox,
  WebhookWriteback,
  noopProjection,
} from '@ontodecide/object-graph/infrastructure';
import {
  createCronHandler,
  createObjectGraphRpc,
  createQueueHandler,
} from '@ontodecide/object-graph/interface';
import {createLogger, systemClock} from '@ontodecide/shared-kernel';
import type {Clock, Logger, QueueBatch} from '@ontodecide/shared-kernel';
import type {Env} from './env';

/** Test and runtime overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** Used for Neo4j and writeback HTTP calls. */
  fetch?: typeof fetch;
}

/** Assembled object-graph service. */
export interface Container {
  deps: AppDeps;
  rpc: ObjectGraphRpc;
  queueHandler(batch: QueueBatch<unknown>): Promise<void>;
  cron(cron: string, now: Date): Promise<MaintenanceReport>;
}

/** Whether the Neo4j projection is enabled and configured. */
export function neo4jEnabled(env: Env): boolean {
  return Boolean(
    env.FEATURE_NEO4J === 'true' &&
    env.NEO4J_URL &&
    env.NEO4J_USER &&
    env.NEO4J_PASSWORD,
  );
}

/** Builds the container from bindings. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger = overrides.logger ?? createLogger({service: 'object-graph'});
  const fetchFn: typeof fetch =
    overrides.fetch ?? ((input, init) => fetch(input, init));
  const db = env.OBJECT_DB;
  const reader = new D1ObjectReader(db);
  const neo4j = neo4jEnabled(env)
    ? new Neo4jClient(
        {
          url: env.NEO4J_URL!,
          user: env.NEO4J_USER!,
          password: env.NEO4J_PASSWORD!,
          database: env.NEO4J_DATABASE,
        },
        fetchFn,
      )
    : null;
  const deps: AppDeps = {
    reader,
    writer: new D1ObjectWriter(db),
    outbox: new QueueOutbox(
      db,
      env.GRAPH_SYNC_QUEUE,
      env.SITUATION_EVENTS_QUEUE,
    ),
    d1Traversal: new D1GraphTraversal(reader),
    ...(neo4j ? {neo4jTraversal: new Neo4jGraphTraversal(neo4j)} : {}),
    projection: neo4j ? new Neo4jProjection(neo4j) : noopProjection,
    writeback: new WebhookWriteback(env.WRITEBACK_SECRET, fetchFn, clock),
    models: new OntologyModelProvider(env.ONTOLOGY, clock),
    integration: env.INTEGRATION,
    actionLogs: new D1ActionLogRepository(db),
    suggestions: new D1MergeSuggestionRepository(db),
    objectSets: new D1ObjectSetRepository(db),
    meta: new D1MetaRepository(db),
    clock,
    logger,
    approvalSecret: env.APPROVAL_SECRET ?? '',
  };
  const queue = createQueueHandler(deps);
  const cron = createCronHandler(deps);
  return {
    deps,
    rpc: createObjectGraphRpc(deps),
    queueHandler: batch => queue(batch),
    cron: (c, now) => cron(c, now),
  };
}
