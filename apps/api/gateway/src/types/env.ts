/**
 * Environment bindings for the Gateway Worker.
 */
import type {BaseEnv} from '@ontodecide/shared';

export interface GatewayEnv extends BaseEnv {
  /** KV namespace holding revoked JWT ids. */
  JWT_BLACKLIST: KVNamespace;
  /** KV namespace holding per-tenant rate-limit counters. */
  RATE_LIMIT: KVNamespace;
  /** Downstream service URLs. */
  USER_SERVICE_URL: string;
  GRAPH_SERVICE_URL: string;
  INGESTION_SERVICE_URL: string;
  AI_SERVICE_URL: string;
  CLEANUP_SERVICE_URL: string;
}
