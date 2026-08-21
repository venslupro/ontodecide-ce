/**
 * Shared Cloudflare Worker environment bindings.
 *
 * Each Worker declares its own `Env` interface that extends the interfaces
 * it actually needs (interface-segregation principle). JWT secrets are no
 * longer distributed to every Worker — only the Gateway (verifies tokens
 * on ingress) and the User Service (signs tokens on login/refresh) hold
 * {@link JwtEnv}. Downstream services trust the `x-tenant-id` /
 * `x-user-role` / `x-internal-call` headers injected by the Gateway.
 */
export interface BaseEnv {
  /** Cloudflare account id (passed via vars for Terraform references). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Default LLM provider name. */
  AI_DEFAULT_PROVIDER?: string;
  /** Workers AI model id. */
  WORKERS_AI_MODEL?: string;
}

/**
 * Environment for services that issue or validate JWTs.
 *
 * Scope: **Gateway Worker** (verifies every inbound request) +
 * **User Service** (signs access/refresh tokens on login/refresh).
 * Downstream Graph/Ingestion/AI/Cleanup services MUST NOT extend this —
 * they receive identity via Gateway-injected headers.
 */
export interface JwtEnv {
  /** HMAC-SHA256 signing key (32+ bytes, keep tightly scoped). */
  JWT_SECRET: string;
}

/** Environment expected by services that need to verify inbound JWTs. */
export interface AuthEnv extends BaseEnv, JwtEnv {
  /** KV namespace holding revoked JWT ids (blacklist). */
  JWT_BLACKLIST: KVNamespace;
}

/**
 * Service Binding declarations for the Gateway Worker.
 *
 * Each entry maps a `[[services]]` block in `wrangler.toml` to a typed
 * `Fetcher`. Gateway uses these bindings for **zero-cost, in-account**
 * calls — no public DNS, no external-request billing, implicit trust.
 */
export interface GatewayServiceBindings {
  /** User Service — auth, profile, admin user mgmt. */
  USER_SERVICE: Fetcher;
  /** Graph Service — Neo4j-backed knowledge graph. */
  GRAPH_SERVICE: Fetcher;
  /** Ingestion Service — ETL pipelines. */
  INGESTION_SERVICE: Fetcher;
  /** AI Service — multi-LLM decision intelligence. */
  AI_SERVICE: Fetcher;
  /** Cleanup Service — retention enforcement. */
  CLEANUP_SERVICE: Fetcher;
}

/**
 * Service binding for the Ingestion → Graph direct call path.
 * Used by the sync ETL loader (≤10 entities) and the queue consumer.
 */
export interface IngestionGraphBinding {
  /** Graph Service Fetcher bound via [[services]] in wrangler.toml. */
  GRAPH_SERVICE: Fetcher;
}

/** A shared-secret header used for service-to-service calls. */
export const INTERNAL_SERVICE_HEADER = 'x-internal-call';
