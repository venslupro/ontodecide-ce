/**
 * Knowledge-graph domain types shared between Graph, Ingestion and AI services.
 */

/** Definition of a node/edge type in the tenant ontology. */
export interface OntologyType {
  /** Stable id, e.g. 'asset'. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Property keys allowed on this type. */
  properties: readonly string[];
  /** Relation types allowed on this type. */
  relations: readonly string[];
  created_at?: string;
}

/** Entity node stored in Neo4j. */
export interface EntityNode {
  id: string;
  tenant_id: string;
  type: string;
  attributes: Record<string, unknown>;
  source: string;
  confidence: number;
  timestamp: string;
}

/** Directional relationship between two entities. */
export interface EntityRelation {
  /** Edge type label, e.g. 'LOCATED_AT'. */
  type: string;
  /** Source entity id. */
  source: string;
  /** Target entity id. */
  target: string;
  /** Optional edge properties. */
  properties?: Record<string, unknown>;
}

/** Situation-view node enriched with first-hop relations. */
export interface SituationNode {
  entity: EntityNode;
  relations: Array<{
    type: string;
    target: Pick<EntityNode, 'id' | 'type' | 'attributes'>;
  }>;
}

/** Request body for the `/graph/explore` endpoint. */
export interface ExploreRequest {
  /** Root entity id to start exploration from. */
  entityId: string;
  /** How many hops to traverse (max 3). */
  depth?: number;
  /** Filter relations by type. */
  relationTypes?: string[];
}

/** Request body for the custom Cypher endpoint (admin-only). */
export interface CypherQueryRequest {
  statement: string;
  parameters?: Record<string, unknown>;
  /** Maximum rows returned, defaults to 100. */
  limit?: number;
}

/** Generic payload describing a batch of entities + relations to ingest. */
export interface IngestPayload {
  tenant_id: string;
  entities: EntityNode[];
  relations: EntityRelation[];
  /** Source identifier (webhook id, file name, etc.). */
  source: string;
}
