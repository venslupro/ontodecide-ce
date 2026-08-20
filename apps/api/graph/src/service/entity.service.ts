/**
 * Entity service: write-path helpers for entity nodes.
 *
 * The Ingestion service calls this when the sync path is taken (small
 * batches); the async path goes through the Ingestion service's own
 * queue consumer, which also calls into the repository directly.
 */
import {type EntityNode, type IngestPayload} from '@ontodecide/shared';
import type {IGraphRepository} from '../repository/graph.repository.js';

export class EntityService {
  constructor(private readonly repo: IGraphRepository) {}

  /** Upsert a batch of entities (and optionally relations). */
  public async upsert(payload: IngestPayload): Promise<{accepted: number}> {
    return this.repo.upsertEntities(payload);
  }

  /** Convenience wrapper for a single entity (no relations). */
  public async upsertOne(entity: EntityNode): Promise<{accepted: number}> {
    return this.repo.upsertEntities({
      tenant_id: entity.tenant_id,
      entities: [entity],
      relations: [],
      source: entity.source,
    });
  }
}
