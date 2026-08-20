/**
 * Environment bindings for the Graph Service.
 */
import type {BaseEnv} from '@ontodecide/shared';

export interface GraphEnv extends BaseEnv {
  /** KV cache namespace (ontology + entity hot caches). */
  CACHE: KVNamespace;
  /** Neo4j AuraDB base URL, e.g. `https://xxx.databases.neo4j.io`. */
  NEO4J_URL: string;
  /** Neo4j username. */
  NEO4J_USER: string;
  /** Neo4j password (set as a Wrangler secret in production). */
  NEO4J_PASSWORD: string;
}

/** Shape of a Neo4j HTTP transactional response. */
export interface Neo4jResponse {
  results: Array<{
    columns: string[];
    data: Array<{
      row: unknown[];
      meta?: unknown;
    }>;
    stats?: Record<string, number>;
  }>;
  errors: Array<{code: string; message: string}> | null;
}
