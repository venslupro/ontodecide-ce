/**
 * @fileoverview Bindings and vars of the api-gateway Worker
 * (ARCHITECTURE.md 2.3). No KV, no Durable Object, no TenantLifecycle
 * binding: the gateway only reaches the business entry points.
 */

import type {DecisionRpc} from '@ontodecide/decision/contract';
import type {IdentityRpc} from '@ontodecide/identity/contract';
import type {IntegrationRpc} from '@ontodecide/integration/contract';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import type {SituationRpc} from '@ontodecide/situation/contract';

/** A binding that also accepts forwarded fetches (WebSocket upgrade). */
export interface FetchBinding {
  fetch(request: Request): Promise<Response>;
}

/** api-gateway environment. */
export interface Env {
  IDENTITY: IdentityRpc;
  ONTOLOGY: OntologyRpc;
  INTEGRATION: IntegrationRpc;
  OBJECTS: ObjectGraphRpc;
  /** RPC plus `fetch` for `GET /situation/stream`. */
  SITUATION: SituationRpc & FetchBinding;
  DECISION: DecisionRpc;
  /** 120 requests / 60 s per user (reads). */
  RL_USER_READ: RateLimit;
  /** 30 requests / 60 s per user (writes). */
  RL_USER_WRITE: RateLimit;
  /** 5 requests / 60 s per e-mail (`POST /auth/codes`). */
  RL_EMAIL: RateLimit;
  /** 10 requests / 60 s per IP (`/auth/*`, `/archive-deletions/*`). */
  RL_IP_AUTH: RateLimit;
  /** `https://ontodecide-ce.<domain>`: the only accepted Origin. */
  APP_ORIGIN: string;
  /** Ed25519 public JWK set (`{"keys": [...]}`) of identity-access. */
  JWT_PUBLIC_KEYS: string;
  /** Request body limit in bytes (default 524288). */
  MAX_BODY_BYTES?: string;
  /** Act-as target status cache, seconds (default 60). */
  ACT_AS_CACHE_S?: string;
  ENVIRONMENT?: string;
  APP_VERSION?: string;
}
