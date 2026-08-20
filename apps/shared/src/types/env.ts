/**
 * Shared Cloudflare Worker environment bindings.
 *
 * Each Worker declares its own `Env` interface that extends `BaseEnv` and
 * adds only the bindings it actually uses. This keeps the surface area
 * small (interface-segregation principle) and makes unit tests easier.
 */
export interface BaseEnv {
  /** Cloudflare account id (passed via vars for Terraform references). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** JWT signing secret shared between Gateway and downstream services. */
  JWT_SECRET: string;
  /** Default LLM provider name. */
  AI_DEFAULT_PROVIDER?: string;
  /** Workers AI model id. */
  WORKERS_AI_MODEL?: string;
}

/** Environment expected by services that need to verify JWTs. */
export interface AuthEnv extends BaseEnv {
  /** KV namespace holding revoked JWT ids (blacklist). */
  JWT_BLACKLIST: KVNamespace;
}

/** Environment for services that call downstream Workers. */
export interface RoutingEnv extends BaseEnv {
  USER_SERVICE_URL: string;
  GRAPH_SERVICE_URL: string;
  INGESTION_SERVICE_URL: string;
  AI_SERVICE_URL: string;
  CLEANUP_SERVICE_URL: string;
}

/** A shared-secret header used for service-to-service calls. */
export const INTERNAL_SERVICE_HEADER = 'x-internal-call';
