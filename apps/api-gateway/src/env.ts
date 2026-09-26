/**
 * @fileoverview Bindings of the api-gateway Worker.
 */

import type {DecisionRpc} from '@ontodecide/decision/contract';
import type {IdentityRpc} from '@ontodecide/identity/contract';
import type {IntegrationRpc} from '@ontodecide/integration/contract';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {SituationRpc} from '@ontodecide/situation/contract';

/** api-gateway environment. */
export interface Env {
  IDENTITY: IdentityRpc;
  ONTOLOGY: OntologyRpc;
  INTEGRATION: IntegrationRpc;
  OBJECTS: ObjectGraphRpc;
  /** RPC plus `fetch` for the WebSocket stream. */
  SITUATION: SituationRpc & Fetcher;
  DECISION: DecisionRpc;
  EDGE_GUARD: DurableObjectNamespace;
  CONFIG: KVNamespace;
  /** Secret: `kid:secret[,kid:secret]`. */
  JWT_SECRET: string;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
  /** "false" only for local http development. */
  COOKIE_SECURE?: string;
}
