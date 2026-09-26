/**
 * @fileoverview Bindings of the object-graph Worker.
 */

import type {IntegrationRpc} from '@ontodecide/integration/contract';
import type {
  GraphSyncMsg,
  SituationEventMsg,
} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {QueueSender} from '@ontodecide/shared-kernel';

/** object-graph environment. */
export interface Env {
  OBJECT_DB: D1Database;
  ONTOLOGY: OntologyRpc;
  INTEGRATION: IntegrationRpc;
  GRAPH_SYNC_QUEUE: QueueSender<GraphSyncMsg>;
  SITUATION_EVENTS_QUEUE: QueueSender<SituationEventMsg>;
  /** "true" enables the Neo4j projection (requires NEO4J_* secrets). */
  FEATURE_NEO4J?: string;
  NEO4J_URL?: string;
  NEO4J_USER?: string;
  NEO4J_PASSWORD?: string;
  NEO4J_DATABASE?: string;
  /** Secret shared with decision-engine for approval vouchers. */
  APPROVAL_SECRET: string;
  /** Secret used to sign writeback webhooks. */
  WRITEBACK_SECRET?: string;
  ENVIRONMENT?: string;
}
