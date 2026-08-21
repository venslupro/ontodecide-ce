/**
 * Neo4j per-tenant logical database naming convention.
 *
 * Each tenant gets their own Neo4j database. This provides strong
 * isolation (no risk of cross-tenant data leakage) and makes cleanup
 * a single `DROP DATABASE` command instead of node-by-node deletion.
 *
 * The tenant_id is an **immutable data anchor** generated at account
 * creation (see `tenantId()`). It is independent of the user's email
 * (login name), so changing the email never requires renaming the
 * Neo4j database.
 *
 * Neo4j database name rules (5.x):
 *   - 3–63 characters
 *   - Lowercase alphanumeric + underscore
 *   - Must start with a letter
 *
 * Tenant IDs in this system already carry the `tenant_` prefix
 * (e.g. "tenant_a1b2c3d4e5f6"), so we sanitise and use them directly.
 */

/** The system database name — used for CREATE/DROP DATABASE commands. */
export const NEO4J_SYSTEM_DB = 'system';

/**
 * Convert a tenant ID into a valid Neo4j database name.
 *
 * Tenant IDs in this system already carry the `tenant_` prefix (see
 * `tenantId()` / `generateUserCredentials()`), so we sanitise the id
 * and use it directly — adding a second `tenant_` prefix would produce
 * `tenant_tenant_…`.
 *
 * Example: "tenant_a1b2c3d4e5f6" → "tenant_a1b2c3d4e5f6"
 */
export function tenantDbName(tenantId: string): string {
  const sanitized = tenantId
      .toLowerCase()
      .replace(/-/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  // If the id already starts with `tenant_`, use it directly; otherwise
  // prepend the prefix (for callers that pass a raw UUID).
  const name = sanitized.startsWith('tenant_') ? sanitized : `tenant_${sanitized}`;
  // Neo4j enforces a 63-char max. If the name is too long, hash it.
  if (name.length > 63) {
    const hash = simpleHash(tenantId);
    return `tenant_${hash}`.slice(0, 63);
  }
  return name;
}

/**
 * Create the Cypher statement for creating a tenant database.
 * Uses IF NOT EXISTS for idempotency.
 */
export function createTenantDbStatement(tenantId: string): string {
  const dbName = tenantDbName(tenantId);
  return `CREATE DATABASE \`${dbName}\` IF NOT EXISTS`;
}

/**
 * Create the Cypher statement for dropping a tenant database.
 * Uses IF EXISTS for idempotency.
 */
export function dropTenantDbStatement(tenantId: string): string {
  const dbName = tenantDbName(tenantId);
  return `DROP DATABASE \`${dbName}\` IF EXISTS`;
}

/** Simple string hash → 16 hex chars (fallback for long IDs). */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
