/**
 * Neo4j Query API implementation of {@link IGraphRepository}.
 *
 * Workers cannot open raw TCP sockets (Bolt), so we use the Neo4j
 * Query API (HTTPS), which is the only HTTP API supported on Aura.
 * The Bolt `NEO4J_URI` (e.g. `neo4j+s://host`) is translated into the
 * equivalent HTTPS endpoint via {@link neo4jHttpBaseUrl}.
 *
 * Endpoint: `POST /db/{database}/query/v2` (implicit transaction).
 * Request:  `{ "statement": "...", "parameters": {...} }`
 * Response: `{ "data": { "fields": [...], "values": [[...]] }, "bookmarks": [...] }`
 *
 * Property isolation: ALL tenants share a single Neo4j database
 * (configured via `NEO4J_DATABASE`). Every node and relationship
 * carries an `organization` property, and every Cypher query explicitly
 * filters by it — e.g. `MATCH (e:Entity {organization: $organization})`.
 */
import {
  EntityNode,
  ERROR_CODES,
  IngestPayload,
  OntologyType,
  SituationNode,
  throwError,
} from '@ontodecide/shared';
import { neo4jHttpBaseUrl, type GraphEnv, type Neo4jResponse } from '../types/env.js';
import type { EntityRelation, IGraphRepository } from './graph.repository.js';

export class Neo4jRepository implements IGraphRepository {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly database: string;

  constructor(env: GraphEnv) {
    this.baseUrl = neo4jHttpBaseUrl(env.NEO4J_URI);
    const credentials = `${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`;
    this.authHeader = 'Basic ' + btoa(credentials);
    this.database = env.NEO4J_DATABASE;
  }

  /**
   * Build the Query API endpoint URL for the shared database.
   * All tenants use the same database; isolation is enforced via
   * `organization` properties in Cypher queries.
   */
  private endpointFor(): string {
    return `${this.baseUrl}/db/${this.database}/query/v2`;
  }

  public async upsertOntology(tenantId: string, type: OntologyType): Promise<void> {
    const statement = `
      MERGE (ot:OntologyType {id: $id, organization: $organization})
      SET ot.name = $name,
          ot.properties = $properties,
          ot.relations = $relations,
          ot.created_at = datetime()
    `;
    await this.execute(statement, {
      id: type.id,
      organization: tenantId,
      name: type.name,
      properties: type.properties,
      relations: type.relations,
    });
  }

  public async listOntology(tenantId: string): Promise<OntologyType[]> {
    const statement = `
      MATCH (ot:OntologyType {organization: $organization})
      RETURN ot.id, ot.name, ot.properties, ot.relations
    `;
    const rows = await this.execute(statement, { organization: tenantId });
    return rows.map((row) => this.decodeOntology(row));
  }

  public async upsertEntities(payload: IngestPayload): Promise<{ accepted: number }> {
    if (payload.entities.length === 0) {
      return { accepted: 0 };
    }

    // Batch all entity MERGEs into a single statement via UNWIND.
    const entities = payload.entities.map((entity) => ({
      id: entity.id,
      organization: entity.tenant_id,
      type: entity.type,
      attributes: JSON.stringify(entity.attributes),
      source: entity.source,
      confidence: entity.confidence,
      timestamp: entity.timestamp,
    }));
    await this.execute(
      `
        UNWIND $entities AS entity
        MERGE (e:Entity {id: entity.id, organization: entity.organization})
        SET e.type = entity.type,
            e.attributes = entity.attributes,
            e.source = entity.source,
            e.confidence = entity.confidence,
            e.timestamp = datetime(entity.timestamp)
      `,
      { entities },
    );

    // Relations cannot parameterise the relationship type, so group by
    // type and issue one UNWIND per type.
    const relationsByType = new Map<string, Array<Record<string, unknown>>>();
    for (const rel of payload.relations) {
      const safeType = sanitizeRelationType(rel.type);
      const list = relationsByType.get(safeType) ?? [];
      list.push({
        sourceId: rel.source,
        targetId: rel.target,
        properties: JSON.stringify(rel.properties ?? {}),
      });
      relationsByType.set(safeType, list);
    }
    for (const [relType, rels] of relationsByType) {
      await this.execute(
        `
          UNWIND $relations AS rel
          MATCH (s:Entity {id: rel.sourceId, organization: $organization}),
                (t:Entity {id: rel.targetId, organization: $organization})
          MERGE (s)-[r:${relType}]->(t)
          SET r.properties = rel.properties
        `,
        { relations: rels, organization: payload.tenant_id },
      );
    }

    return { accepted: payload.entities.length };
  }

  public async findEntities(
    tenantId: string,
    filter: { type?: string; attributes?: Record<string, unknown> },
    limit = 100,
  ): Promise<EntityNode[]> {
    const typeClause = filter.type ? 'AND e.type = $type' : '';
    const statement = `
      MATCH (e:Entity {organization: $organization})
      WHERE 1=1 ${typeClause}
      RETURN e.id, e.type, e.attributes, e.source, e.confidence, e.timestamp
      LIMIT $limit
    `;
    const rows = await this.execute(statement, {
      organization: tenantId,
      type: filter.type,
      limit,
    });
    return rows.map((row) => this.decodeEntity(row, tenantId));
  }

  public async findEntity(tenantId: string, entityId: string): Promise<EntityNode | null> {
    const statement = `
      MATCH (e:Entity {organization: $organization, id: $id})
      RETURN e.id, e.type, e.attributes, e.source, e.confidence, e.timestamp
      LIMIT 1
    `;
    const rows = await this.execute(statement, { organization: tenantId, id: entityId });
    if (rows.length === 0) return null;
    return this.decodeEntity(rows[0], tenantId);
  }

  public async deleteEntity(tenantId: string, entityId: string): Promise<number> {
    const statement = `
      MATCH (e:Entity {organization: $organization, id: $id})
      DETACH DELETE e
      RETURN count(e) as deleted
    `;
    const rows = await this.execute(statement, { organization: tenantId, id: entityId });
    const row = rows[0] ?? [];
    return Number(row[0] ?? 0);
  }

  public async situationView(tenantId: string, rootId: string, depth = 1): Promise<SituationNode> {
    const safeDepth = Math.min(Math.max(depth, 1), 3);
    const statement = `
      MATCH (e:Entity {organization: $organization, id: $id})
      OPTIONAL MATCH path = (e)-[*1..${safeDepth}]-(n:Entity {organization: $organization})
      RETURN e.id, e.type, e.attributes, e.source, e.confidence, e.timestamp,
             collect(DISTINCT {
               rel: [r IN relationships(path) | type(r)],
               target: {id: n.id, type: n.type, attributes: n.attributes}
             }) as relations
    `;
    const rows = await this.execute(statement, { organization: tenantId, id: rootId });
    if (rows.length === 0) {
      throwError(ERROR_CODES.GRAPH_ENTITY_NOT_FOUND, `Entity ${rootId} not found.`);
    }
    const row = rows[0] ?? [];
    const entity = this.decodeEntity(row, tenantId);
    const relations =
      (row[6] as
        | Array<{
            rel: string[];
            target: { id: string; type: string; attributes: string };
          }>
        | undefined) ?? [];
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
    const relFilter =
      relationTypes && relationTypes.length > 0 ? `WHERE type(r) IN $relationTypes` : '';
    const statement = `
      MATCH (e:Entity {organization: $organization, id: $id})
      MATCH (e)-[r*1..${safeDepth}]-(n:Entity {organization: $organization})
      ${relFilter}
      RETURN e.id, e.type, e.attributes, e.source, e.confidence, e.timestamp,
             collect({rel: type(r), target: {
               id: n.id, type: n.type, attributes: n.attributes
             }}) as relations
    `;
    const rows = await this.execute(statement, {
      organization: tenantId,
      id: rootId,
      relationTypes: relationTypes ?? [],
    });
    return rows.map((row) => {
      const entity = this.decodeEntity(row, tenantId);
      const relations =
        (row[6] as
          | Array<{
              rel: string;
              target: { id: string; type: string; attributes: string };
            }>
          | undefined) ?? [];
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
    // Reject write operations — custom queries are read-only.
    if (/\b(CREATE|MERGE|DELETE|SET|REMOVE|DROP)\b/i.test(statement)) {
      throwError(ERROR_CODES.AUTH_FORBIDDEN, 'Custom queries may only read.');
    }
    // Enforce tenant isolation: the query must reference the $organization
    // parameter so it cannot return data belonging to other tenants.
    if (!/\$organization\b/.test(statement)) {
      throwError(
        ERROR_CODES.AUTH_FORBIDDEN,
        'Custom queries must filter by the $organization parameter to enforce tenant isolation.',
      );
    }
    const safeStatement = statement.includes('LIMIT')
      ? statement
      : `${statement.replace(/;$/, '')} LIMIT $limit`;
    const params = { ...parameters, organization: tenantId, limit };
    const rows = await this.execute(safeStatement, params);
    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      row.forEach((value, idx) => {
        obj[`col_${idx}`] = value;
      });
      return obj;
    });
  }

  /**
   * Delete all tenant-owned nodes and relationships via property isolation.
   * Uses `MATCH (n {organization: $organization}) DETACH DELETE n` on the
   * shared database.
   */
  public async deleteTenant(tenantId: string): Promise<number> {
    const statement = `
      MATCH (n {organization: $organization})
      DETACH DELETE n
      RETURN count(n) as deleted
    `;
    const rows = await this.execute(statement, { organization: tenantId });
    const row = rows[0] ?? [];
    return Number(row[0] ?? 0);
  }

  /**
   * Execute a single Cypher statement via the Query API.
   * Returns an array of rows, where each row is an array of values.
   */
  private async execute(
    statement: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown[][]> {
    const response = await fetch(this.endpointFor(), {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ statement, parameters }),
    });

    // Query API returns 202 for all successfully-executed requests
    // (including Cypher errors reported in the body). Auth errors are 401.
    if (response.status === 401) {
      throwError(ERROR_CODES.GRAPH_NEO4J_UNAVAILABLE, 'Neo4j authentication failed.');
    }
    if (response.status !== 202 && !response.ok) {
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
    return data.data?.values ?? [];
  }

  /** Decode a Query API value row into an EntityNode. */
  private decodeEntity(row: unknown[], tenantId: string): EntityNode {
    const attributes =
      typeof row[2] === 'string'
        ? JSON.parse(row[2] as string)
        : (row[2] as Record<string, unknown>);
    return {
      id: String(row[0]),
      tenant_id: tenantId,
      type: String(row[1]),
      attributes,
      source: String(row[3] ?? 'unknown'),
      confidence: Number(row[4] ?? 0),
      timestamp: String(row[5] ?? new Date().toISOString()),
    };
  }

  /** Decode a Query API value row into an OntologyType. */
  private decodeOntology(row: unknown[]): OntologyType {
    const props =
      typeof row[2] === 'string' ? JSON.parse(row[2] as string) : (row[2] as string[]);
    const rels =
      typeof row[3] === 'string' ? JSON.parse(row[3] as string) : (row[3] as string[]);
    return {
      id: String(row[0]),
      name: String(row[1]),
      properties: Array.isArray(props) ? props : [],
      relations: Array.isArray(rels) ? rels : [],
    };
  }
}

/** Suppress unused-import warning when `EntityRelation` is not referenced. */
export type { EntityRelation };

/**
 * Sanitise a relation type for direct insertion into a Cypher statement.
 * Neo4j forbids parameterising relationship type labels, so we restrict
 * them to `[A-Z][A-Z0-9_]{0,62}` and reject anything else.
 */
function sanitizeRelationType(label: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,62}$/.test(label)) {
    throwError(ERROR_CODES.VALIDATION_FAILED, `Invalid relation type label: ${label}`);
  }
  return label;
}
