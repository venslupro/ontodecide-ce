/**
 * @fileoverview Bindings of the situation-awareness Worker (ARCHITECTURE
 * 2.3): the SituationRoom namespace, object-graph and ontology-manager.
 */

import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';

/** situation-awareness environment. */
export interface Env {
  SITUATION_ROOM: DurableObjectNamespace;
  OBJECTS: ObjectGraphRpc;
  ONTOLOGY: OntologyRpc;
  /** Public origin; forwarded WebSocket upgrades must come from it. */
  APP_ORIGIN?: string;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
}
