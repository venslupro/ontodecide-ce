/**
 * Neo4j property-isolation architecture.
 *
 * This system uses a **single Neo4j database** (configured via the
 * `NEO4J_DATABASE` environment variable) for ALL tenants. Isolation
 * is achieved through **property isolation**: every node and relationship
 * carries a `tenant_id` property, and every Cypher query explicitly
 * filters by `tenant_id`.
 *
 * This is the recommended approach for Neo4j AuraDB single-instance
 * deployments and dynamic-tenant SaaS scenarios:
 *
 *   - No CREATE/DROP DATABASE per tenant (AuraDB Free/Pro may not
 *     support multi-database or limits the count).
 *   - Cleanup is `MATCH (n {tenant_id: $tid}) DETACH DELETE n` —
 *     removes all tenant-owned nodes and relationships in one query.
 *   - The `tenant_id` is an immutable data anchor assigned at account
 *     creation (see `tenantId()` in id-generator.ts), independent of
 *     the user's email (login name).
 *
 * All Cypher statements in the Graph Service already include
 * `tenant_id` in MERGE/MATCH patterns (e.g. `MERGE (e:Entity
 * {id: $id, tenant_id: $tenantId})`), so property isolation is
 * enforced at the query level.
 */
