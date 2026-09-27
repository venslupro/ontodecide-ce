/**
 * @fileoverview Bindings of the data-integration Worker (ARCHITECTURE 2.3).
 */

import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';

/** data-integration environment. */
export interface Env {
  INTEGRATION_DB: D1Database;
  /** Service binding → ontology-manager / OntologyRpc. */
  ONTOLOGY: OntologyRpc;
  /** Service binding → object-graph / ObjectGraphRpc. */
  OBJECTS: ObjectGraphRpc;
  /** Workers AI; absent locally, then mapping drafts use rules only. */
  AI?: Ai;
  /** Default `@cf/qwen/qwen3-30b-a3b-fp8`. */
  AI_MODEL?: string;
  /** Service Neurons per UTC day (default 1500). */
  NEURONS_DAILY_BUDGET?: string;
  /** Import rows per workspace per UTC day (default 2000). */
  IMPORT_ROWS_DAILY?: string;
  /** Global sample-data D1 rows per UTC day (default 20000). */
  SEED_ROWS_DAILY?: string;
  /** AI mapping drafts per user per UTC day (default 2). */
  MAPPING_AI_DAILY?: string;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
}
