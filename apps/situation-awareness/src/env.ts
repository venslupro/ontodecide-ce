/**
 * @fileoverview Bindings of the situation-awareness Worker.
 */

import type {IngestMsg, ObjectWriteMsg} from '@ontodecide/integration/contract';
import type {
  GraphSyncMsg,
  ObjectGraphRpc,
  SituationEventMsg,
} from '@ontodecide/object-graph/contract';
import type {DecisionJobMsg} from '@ontodecide/situation/contract';
import type {QueueSender} from '@ontodecide/shared-kernel';

/** situation-awareness environment. */
export interface Env {
  SITUATION_DB: D1Database;
  SITUATION_ROOM: DurableObjectNamespace;
  USAGE_GUARD: DurableObjectNamespace;
  OBJECTS: ObjectGraphRpc;
  DECISION_JOBS_QUEUE: QueueSender<DecisionJobMsg>;
  /** Producers used only to replay dead letters. */
  INGEST_QUEUE: QueueSender<IngestMsg>;
  OBJECT_WRITES_QUEUE: QueueSender<ObjectWriteMsg>;
  GRAPH_SYNC_QUEUE: QueueSender<GraphSyncMsg>;
  SITUATION_EVENTS_QUEUE: QueueSender<SituationEventMsg>;
  USAGE_WARN?: string;
  USAGE_STOP?: string;
  ENVIRONMENT?: string;
}
