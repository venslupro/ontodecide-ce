/**
 * Ontology service (application layer).
 *
 * Wraps {@link IGraphRepository} — reads go directly to Neo4j.
 */
import type { OntologyType } from '@ontodecide/shared';
import { Ontology } from '../domain/ontology.js';
import type { IGraphRepository } from '../repository/graph.repository.js';

export class OntologyService {
  constructor(private readonly repo: IGraphRepository) {}

  /** Create or replace an ontology type for the tenant. */
  public async upsert(tenantId: string, type: OntologyType): Promise<void> {
    const ontology = Ontology.fromInput(type);
    await this.repo.upsertOntology(tenantId, ontology.toType());
  }

  /** List all ontology types for the tenant. */
  public async list(tenantId: string): Promise<OntologyType[]> {
    return this.repo.listOntology(tenantId);
  }
}
