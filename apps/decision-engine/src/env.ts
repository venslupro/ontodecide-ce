/**
 * @fileoverview Bindings and vars of the decision-engine Worker
 * (docs/ARCHITECTURE.md 2.3).
 */

import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {SituationRpc} from '@ontodecide/situation/contract';

/** decision-engine environment. */
export interface Env {
  DECISION_DB: D1Database;
  OBJECTS: ObjectGraphRpc;
  SITUATION: SituationRpc;
  ONTOLOGY: OntologyRpc;
  /** Workers AI; absent in local dev, where ranking falls back to rules. */
  AI?: Ai;
  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
  REC_AI_USER_DAILY_LIMIT?: string;
  NEURONS_DAILY_BUDGET?: string;
  NEURONS_RESERVE_FACTOR?: string;
  REC_EXPIRE_HOURS?: string;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
}
