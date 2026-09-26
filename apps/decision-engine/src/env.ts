/**
 * @fileoverview Bindings of the decision-engine Worker.
 */

import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {
  DecisionJobMsg,
  SituationRpc,
} from '@ontodecide/situation/contract';
import type {QueueSender} from '@ontodecide/shared-kernel';

/** decision-engine environment. */
export interface Env {
  DECISION_DB: D1Database;
  /** Workers AI; absent in local dev (the chain then skips it). */
  AI?: Ai;
  /** Vectorize; absent locally (falls back to dec_case brute force). */
  VEC?: VectorizeIndex;
  OBJECTS: ObjectGraphRpc;
  SITUATION: SituationRpc;
  ONTOLOGY: OntologyRpc;
  DECISION_JOBS_QUEUE: QueueSender<DecisionJobMsg>;
  /** Comma separated: workers-ai,gemini,groq. */
  LLM_CHAIN?: string;
  LLM_TENANT_DAILY_LIMIT?: string;
  LLM_USER_DAILY_LIMIT?: string;
  REC_EXPIRE_HOURS?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  /** Secret shared with object-graph for approval vouchers. */
  APPROVAL_SECRET: string;
  ENVIRONMENT?: string;
}
