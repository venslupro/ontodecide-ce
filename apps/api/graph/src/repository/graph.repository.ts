/**
 * Repository interface for the Knowledge-Graph bounded context.
 *
 * The interface is intentionally small (interface-segregation principle).
 * Higher-level services (`OntologyService`, `SituationService`) depend on
 * this abstraction so a different graph backend can be swapped in without
 * touching the domain logic.
 */
import type {
  EntityNode,
  EntityRelation,
  IngestPayload,
  OntologyType,
  SituationNode,
} from '@ontodecide/shared';

export interface IGraphRepository {
  /** Create or replace a tenant's ontology type definition. */
  upsertOntology(tenantId: string, type: OntologyType): Promise<void>;

  /** Read all ontology types for the tenant. */
  listOntology(tenantId: string): Promise<OntologyType[]>;

  /** Insert entity nodes (and optionally relations) for a tenant. */
  upsertEntities(payload: IngestPayload): Promise<{accepted: number}>;

  /** Find entities by type or attributes. */
  findEntities(
    tenantId: string,
    filter: {type?: string; attributes?: Record<string, unknown>},
    limit?: number,
  ): Promise<EntityNode[]>;

  /** Find a single entity by id. */
  findEntity(tenantId: string, entityId: string): Promise<EntityNode | null>;

  /** Delete an entity and its relations. */
  deleteEntity(tenantId: string, entityId: string): Promise<number>;

  /** Fetch the situation view: entity + first-hop relations. */
  situationView(tenantId: string, rootId: string, depth?: number): Promise<SituationNode>;

  /** Two-hop exploration from a root entity, filtered by relation types. */
  explore(
    tenantId: string,
    rootId: string,
    depth: number,
    relationTypes?: string[],
  ): Promise<SituationNode[]>;

  /** Run a custom Cypher query (admin-only). */
  runCypher(
    tenantId: string,
    statement: string,
    parameters?: Record<string, unknown>,
    limit?: number,
  ): Promise<Record<string, unknown>[]>;

  /** Delete all data for a tenant (used by the Cleanup service). */
  deleteTenant(tenantId: string): Promise<number>;
}

/** Re-export EntityRelation so callers do not depend on the shared module
 *  for graph-domain types. */
export type {EntityRelation};
