/**
 * Environment bindings for the Graph Service.
 */
import type { BaseEnv } from '@ontodecide/shared';

export interface GraphEnv extends BaseEnv {
  /**
   * Neo4j connection URI, e.g. `neo4j+s://c757868d.databases.neo4j.io`.
   * Workers cannot use Bolt (TCP), so the repository derives the HTTPS
   * transactional endpoint from this URI's hostname.
   */
  NEO4J_URI: string;
  /** Neo4j username (for Aura, this is the instance id). */
  NEO4J_USERNAME: string;
  /** Neo4j password (set as a Wrangler secret in production). */
  NEO4J_PASSWORD: string;
  /** Neo4j database name (single shared DB for all tenants). */
  NEO4J_DATABASE: string;
}

/** Shape of a Neo4j Query API response. */
export interface Neo4jResponse {
  data?: {
    fields: string[];
    values: unknown[][];
  };
  bookmarks?: string[];
  errors?: Array<{ code: string; message: string }> | null;
}

/**
 * Derive the HTTPS transactional-API base URL from a Neo4j connection URI.
 *
 * Cloudflare Workers cannot open raw TCP sockets (Bolt), so we translate
 * the Bolt URI into the equivalent HTTPS endpoint that serves the
 * transactional Cypher HTTP API.
 *
 *   neo4j://host[:port]      → http://host[:port]
 *   neo4j+s://host[:port]    → https://host[:port]
 *   neo4j+ssc://host[:port]  → https://host[:port]
 *   http(s)://host[:port]    → passed through unchanged
 *
 * @param uri A Neo4j connection string.
 * @returns The HTTPS (or HTTP) base URL for the transactional API.
 */
export function neo4jHttpBaseUrl(uri: string): string {
  const parsed = new URL(uri);
  const proto = parsed.protocol.replace(/:$/, '');
  // Pick the HTTP-family protocol that matches the Bolt scheme's
  // transport security.
  const httpProto = proto === 'neo4j+s' || proto === 'neo4j+ssc' || proto === 'https' ? 'https' : 'http';
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${httpProto}://${parsed.hostname}${port}`;
}
