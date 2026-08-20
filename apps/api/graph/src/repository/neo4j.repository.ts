/**
 * Neo4j HTTP-transactional implementation of {@link IGraphRepository}.
 *
 * Workers cannot open raw TCP sockets, so we use the Neo4j HTTP
 * transactional endpoint which accepts a JSON body of Cypher
 * statements.
 *
 * Per-tenant logical database isolation: each tenant gets their own
 * Neo4j database (created by the User Service at signup). The
 * endpoint URL is dynamic — `/db/<tenantDbName>/tx/commit` — so
 * all Cypher statements are automatically isolated at the database
 * level. No `WHERE n.tenant_id = $tid` clause is needed anymore.
 *
 * Database lifecycle:
 *   - Created: User Service calls CREATE DATABASE on /db/system
 *   - Dropped:  Cleanup Service calls DROP DATABASE on /db/system
 */
import {
  EntityNode,
  ERROR_CODES,
  IngestPayload,
  OntologyType,
  SituationNode,
  throwError,
  tenantDbName,
} from '@ontodecide/shared';
import type {GraphEnv, Neo4jResponse} from '../types/env.js';
import type {EntityRelation, IGraphRepository} from './graph.repository.js';

interface Neo4jRow {
  row: unknown[];
}

export class Neo4jRepository implements IGraphRepository {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(env: GraphEnv) {
    this.baseUrl = env.NEO4J_URL.replace(/\/$/, '');
    const credentials = `${env.NEO4J_USER}:${env.NEO4J_PASSWORD}`;
    this.authHeader = 'Basic ' + btoa(credentials);
  }

  /**
   * Build the transactional endpoint URL for a given tenant's
   * database. Each tenant has their own logical database created
   * at signup; all queries are routed there automatically.
   */
  private endpointFor(tenantId: string): string {
    const db = tenantDbName(tenantId);
    return `${this.baseUrl}/db/${db}/tx/commit`;
  }

  public async upsertOntology(tenantId: string, type: OntologyType): Promise<void> {
    const statement = `
      MERGE (ot:OntologyType {id: $id, tenant_id: $tenantId})
      SET ot.name = $name,
          ot.properties = $properties,
          ot.relations = $relations,
          ot.created_at = datetime()
    `;
    await this.execute(tenantId, statement, {
      id: type.id,
      tenantId,
      name: type.name,
      properties: type.properties,
      relations: type.relations,
    });
  }

  public async listOntology(tenantId: string): Promise<OntologyType[]> {
    const statement = `
      MATCH (ot:OntologyType {tenant_id: $tenantId})
      RETURN ot.id, ot.name, ot.properties, ot.relations
    `;
    const rows = await this.execute(tenantId, statement, {tenantId});
    return rows.map((row) => this.decodeOntology(row));
  }

  public async upsertEntities(payload: IngestPayload): Promise<{accepted: number}> {
    // Single-transaction batch: keep the request under the 10ms CPU budget
    // by limiting batches to ~50 entities (Ingestion Service is responsible
    // for chunking larger files).
    if (payload.entities.length === 0) {
      return {accepted: 0};
    }
    const entityStatements = payload.entities.map((entity) => {
      const params = {
        id: entity.id,
        tenantId: entity.tenant_id,
        type: entity.type,
        attributes: JSON.stringify(entity.attributes),
        source: entity.source,
        confidence: entity.confidence,
        timestamp: entity.timestamp,
      };
      return {
        statement: `
          MERGE (e:Entity {id: $id, tenant_id: $tenantId})
          SET e.type = $type,
              e.attributes = $attributes,
              e.source = $source,
              e.confidence = $confidence,
              e.timestamp = datetime($timestamp)
        `,
        parameters: params,
      };
    });
    const relationStatements = payload.relations.map((rel) => {
      // Neo4j does not allow relation types to be parameterised, so we
      // sanitise the label by allowing only UPPER_SNAKE_CASE strings.
      const safeRelType = sanitizeRelationType(rel.type);
      const params = {
        sourceId: rel.source,
        targetId: rel.target,
        tenantId: payload.tenant_id,
        properties: JSON.stringify(rel.properties ?? {}),
      };
      return {
        statement: `
          MATCH (s:Entity {id: $sourceId, tenant_id: $tenantId}),
                (t:Entity {id: $targetId, tenant_id: $tenantId})
          MERGE (s)-[r:${safeRelType}]->(t)
          SET r.properties = $properties
        `,
        parameters: params,
      };
    });
    const statements = [...entityStatements, ...relationStatements];
    await this.executeBatch(payload.tenant_id, statements);
    return {accepted: payload.entities.length};
  }

  public async findEntities(
      tenantId: string,
      filter: {type?: string; attributes?: Record<string, unknown>},
      limit = 100,
  ): Promise<EntityNode[]> {
    const typeClause = filter.type ? 'AND e.type = $type' : '';
    const statement = `
      MATCH (e:Entity {tenant_id: $tenantId})
      WHERE 1=1 ${typeClause}
      RETURN e.id, e.type, e.attributes, e.source, e.confidence, e.timestamp
      LIMIT $limit
    `;
    const rows = await this.execute(tenantId, statement, {
      tenantId,
      type: filter.type,
      limit,
    });
    return rows.map((row) => this.decodeEntity(row, tenantId));
  }

  public async findEntity(tenantId: string, entityId: string): Promise<EntityNode | null> {
    const statement = `
      MATCH (e:Entity {tenant_id: $tenantId, id: $id})
      RETURN e.id, e.type, e.attributes, e.source, e.confidence, e.timestamp
      LIMIT 1
    `;
    const rows = await this.execute(tenantId, statement, {tenantId, id: entityId});
    if (rows.length === 0) return null;
    return this.decodeEntity(rows[0], tenantId);
  }

  public async deleteEntity(tenantId: string, entityId: string): Promise<number> {
    const statement = `
      MATCH (e:Entity {tenant_id: $tenantId, id: $id})
      DETACH DELETE e
      RETURN count(e) as deleted
    `;
    const rows = await this.execute(tenantId, statement, {tenantId, id: entityId});
    const row = rows[0]?.row as unknown[];
    return Number(row?.[0] ?? 0);
  }

  public async situationView(
      tenantId: string,
      rootId: string,
      depth = 1,
  ): Promise<SituationNode> {
    const safeDepth = Math.min(Math.max(depth, 1), 3);
    const statement = `
      MATCH (e:Entity {tenant_id: $tenantId, id: $id})
      OPTIONAL MATCH path = (e)-[*1..${safeDepth}]-(n:Entity {tenant_id: $tenantId})
      RETURN e, collect(DISTINCT {
        rel: [r IN relationships(path) | type(r)],
        target: {id: n.id, type: n.type, attributes: n.attributes}
      }) as relations
    `;
    const rows = await this.execute(tenantId, statement, {tenantId, id: rootId});
    if (rows.length === 0) {
      throwError(ERROR_CODES.GRAPH_ENTITY_NOT_FOUND, `Entity ${rootId} not found.`);
    }
    const entity = this.decodeEntity(rows[0], tenantId);
    const relRow = rows[0]?.row as unknown[];
    const relations = (relRow?.[1] as Array<{
      rel: string[];
      target: {id: string; type: string; attributes: string};
    }> | undefined) ?? [];
    return {
      entity,
      relations: relations.map((r) => ({
        type: (r.rel ?? []).join('->'),
        target: {
          id: r.target?.id ?? '',
          type: r.target?.type ?? '',
          attributes: r.target?.attributes ? JSON.parse(r.target.attributes) : {},
        },
      })),
    };
  }

  public async explore(
      tenantId: string,
      rootId: string,
      depth: number,
      relationTypes?: string[],
  ): Promise<SituationNode[]> {
    const safeDepth = Math.min(Math.max(depth, 1), 3);
    const relFilter = relationTypes && relationTypes.length > 0 ?
      `WHERE type(r) IN $relationTypes` :
      '';
    const statement = `
      MATCH (e:Entity {tenant_id: $tenantId, id: $id})
      MATCH (e)-[r*1..${safeDepth}]-(n:Entity {tenant_id: $tenantId})
      ${relFilter}
      RETURN e, collect({rel: type(r), target: {
        id: n.id, type: n.type, attributes: n.attributes
      }}) as relations
    `;
    const rows = await this.execute(tenantId, statement, {
      tenantId,
      id: rootId,
      relationTypes: relationTypes ?? [],
    });
    return rows.map((row) => {
      const entity = this.decodeEntity(row, tenantId);
      const relRow = row.row as unknown[];
      const relations = (relRow[1] as Array<{
        rel: string;
        target: {id: string; type: string; attributes: string};
      }> | undefined) ?? [];
      return {
        entity,
        relations: relations.map((r) => ({
          type: r.rel,
          target: {
            id: r.target?.id ?? '',
            type: r.target?.type ?? '',
            attributes: r.target?.attributes ? JSON.parse(r.target.attributes) : {},
          },
        })),
      };
    });
  }

  public async runCypher(
      tenantId: string,
      statement: string,
      parameters: Record<string, unknown> = {},
      limit = 100,
  ): Promise<Record<string, unknown>[]> {
    // Defensive: forbid write operations on the custom-query endpoint.
    if (/\b(CREATE|MERGE|DELETE|SET|REMOVE|DROP)\b/i.test(statement)) {
      throwError(
          ERROR_CODES.AUTH_FORBIDDEN,
          'Custom queries may only read.',
      );
    }
    const safeStatement = statement.includes('LIMIT') ?
      statement :
      `${statement.replace(/;$/, '')} LIMIT $limit`;
    const params = {...parameters, tenantId, limit};
    const rows = await this.execute(tenantId, safeStatement, params);
    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      const values = row.row as unknown[];
      values.forEach((value, idx) => {
        obj[`col_${idx}`] = value;
      });
      return obj;
    });
  }

  /**
   * Drop the tenant's entire Neo4j database.
   *
   * This is a system-level command sent to /db/system/tx/commit.
   * It instantly removes ALL nodes, relationships, indexes, and
   * constraints for the tenant — far faster than node-by-node
   * DETACH DELETE, and with zero risk of partial deletion.
   *
   * The database is created by the User Service at signup; here we
   * only drop it.
   */
  public async deleteTenant(tenantId: string): Promise<number> {
    const {dropTenantDbStatement} = await import('@ontodecide/shared');
    const systemEndpoint = `${this.baseUrl}/db/system/tx/commit`;
    const body = JSON.stringify({
      statements: [{statement: dropTenantDbStatement(tenantId)}],
    });
    const response = await fetch(systemEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json;charset=UTF-8',
      },
      body,
    });
    if (!response.ok) {
      throwError(
          ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE,
          `Neo4j DROP DATABASE HTTP ${response.status}: ${await response.text()}`,
      );
    }
    // DROP DATABASE doesn't return a count; return 1 for success.
    return 1;
  }

  /** Execute a single Cypher statement on the tenant's database. */
  private async execute(
      tenantId: string,
      statement: string,
      parameters: Record<string, unknown>,
  ): Promise<Neo4jRow[]> {
    const endpoint = this.endpointFor(tenantId);
    const body = JSON.stringify({
      statements: [{statement, parameters}],
    });
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json;charset=UTF-8',
      },
      body,
    });
    if (!response.ok) {
      throwError(
          ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE,
          `Neo4j HTTP ${response.status}: ${await response.text()}`,
      );
    }
    const data = (await response.json()) as Neo4jResponse;
    if (data.errors && data.errors.length > 0) {
      const first = data.errors[0];
      throwError(ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE, `${first.code}: ${first.message}`);
    }
    return data.results[0]?.data ?? [];
  }

  /** Execute multiple Cypher statements in one HTTP round-trip. */
  private async executeBatch(
      tenantId: string,
      statements: Array<{statement: string; parameters: Record<string, unknown>}>,
  ): Promise<Neo4jRow[]> {
    const endpoint = this.endpointFor(tenantId);
    const body = JSON.stringify({statements});
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json;charset=UTF-8',
      },
      body,
    });
    if (!response.ok) {
      throwError(
          ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE,
          `Neo4j HTTP ${response.status}: ${await response.text()}`,
      );
    }
    const data = (await response.json()) as Neo4jResponse;
    if (data.errors && data.errors.length > 0) {
      const first = data.errors[0];
      throwError(ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE, `${first.code}: ${first.message}`);
    }
    return data.results.flatMap((r) => r.data);
  }

  /** Decode a Neo4j row into an EntityNode. */
  private decodeEntity(row: Neo4jRow, tenantId: string): EntityNode {
    const values = row.row as unknown[];
    const attributes = typeof values[2] === 'string' ? JSON.parse(values[2] as string) : (values[2] as Record<string, unknown>);
    return {
      id: String(values[0]),
      tenant_id: tenantId,
      type: String(values[1]),
      attributes,
      source: String(values[3] ?? 'unknown'),
      confidence: Number(values[4] ?? 0),
      timestamp: String(values[5] ?? new Date().toISOString()),
    };
  }

  /** Decode a Neo4j row into an OntologyType. */
  private decodeOntology(row: Neo4jRow): OntologyType {
    const values = row.row as unknown[];
    const props = typeof values[2] === 'string' ? JSON.parse(values[2] as string) : (values[2] as string[]);
    const rels = typeof values[3] === 'string' ? JSON.parse(values[3] as string) : (values[3] as string[]);
    return {
      id: String(values[0]),
      name: String(values[1]),
      properties: Array.isArray(props) ? props : [],
      relations: Array.isArray(rels) ? rels : [],
    };
  }
}

/** Suppress unused-import warning when `EntityRelation` is not referenced in
 *  some build configurations (e.g. when only the interface is consumed). */
export type {EntityRelation};

/**
 * Sanitise a relation type for direct insertion into a Cypher statement.
 *
 * Neo4j forbids parameterising relationship type labels, so we restrict
 * them to `[A-Z][A-Z0-9_]{0,62}` and reject anything else. This both
 * prevents Cypher injection and keeps the label usable in indexes.
 */
function sanitizeRelationType(label: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,62}$/.test(label)) {
    throwError(
        ERROR_CODES.VALIDATION_FAILED,
        `Invalid relation type label: ${label}`,
    );
  }
  return label;
}
