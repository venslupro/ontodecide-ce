/**
 * @fileoverview Bindings of the object-graph Worker (ARCHITECTURE 2.3).
 */

import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {DomainEventMsg, QueueSender} from '@ontodecide/shared-kernel';

/** object-graph environment. */
export interface Env {
  OBJECT_DB: D1Database;
  /** ontology-manager / OntologyRpc service binding. */
  ONTOLOGY: OntologyRpc;
  /** Producer of the `domain-events` queue. */
  DOMAIN_EVENTS: QueueSender<DomainEventMsg>;
  /** Objects per workspace (default 300). */
  MAX_OBJECTS?: string;
  /** Links per workspace (default 900). */
  MAX_LINKS?: string;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
}
