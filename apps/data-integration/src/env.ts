/**
 * @fileoverview Bindings of the data-integration Worker.
 */

import type {IngestMsg, ObjectWriteMsg} from '@ontodecide/integration/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {QueueSender} from '@ontodecide/shared-kernel';

/** data-integration environment. */
export interface Env {
  INTEGRATION_DB: D1Database;
  ONTOLOGY: OntologyRpc;
  INGEST_QUEUE: QueueSender<IngestMsg>;
  OBJECT_WRITES_QUEUE: QueueSender<ObjectWriteMsg>;
  B2_BUCKET?: string;
  B2_REGION?: string;
  B2_ENDPOINT?: string;
  /** Secrets; when absent presign returns a local no-op URL. */
  B2_KEY_ID?: string;
  B2_APP_KEY?: string;
  /** Secret: AES-GCM key for connector credentials. */
  CONNECTOR_ENC_KEY?: string;
  ENVIRONMENT?: string;
}
