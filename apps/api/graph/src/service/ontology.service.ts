/**
 * Ontology service (application layer).
 *
 * Wraps {@link IGraphRepository} with caching (KV) so the frequent reads
 * during ingestion and situation rendering do not hit Neo4j directly.
 */
import { CACHE_KEYS, CACHE_TTL, type OntologyType } from '@ontodecide/shared';
import { Ontology } from '../domain/ontology.js';
import type { IGraphRepository } from '../repository/graph.repository.js';

export class OntologyService {
  constructor(
    private readonly repo: IGraphRepository,
    private readonly cache: KVNamespace,
  ) {}

  /** Create or replace an ontology type for the tenant. */
  public async upsert(tenantId: string, type: OntologyType): Promise<void> {
    const ontology = Ontology.fromInput(type);
    await this.repo.upsertOntology(tenantId, ontology.toType());
    // Invalidate the cached list so subsequent reads see the new shape.
    await this.cache.delete(CACHE_KEYS.ontology(tenantId));
  }

  /** List all ontology types for the tenant (cached for 1h). */
  public async list(tenantId: string): Promise<OntologyType[]> {
    const cacheKey = CACHE_KEYS.ontology(tenantId);
    const cached = await this.cache.get(cacheKey, 'json');
    if (Array.isArray(cached)) {
      return cached as OntologyType[];
    }
    const items = await this.repo.listOntology(tenantId);
    await this.cache.put(cacheKey, JSON.stringify(items), {
      expirationTtl: CACHE_TTL.ONTOLOGY,
    });
    return items;
  }
}
