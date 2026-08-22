/**
 * Situation service: renders the unified situation view and the
 * exploration graph.
 *
 * The situation view is the design doc's "single pane of glass": given a
 * root entity, return that entity plus its first-hop relations (depth 1 by
 * default; the client can request up to 3 hops via `ExploreRequest.depth`).
 *
 * Hot roots are cached for 5 minutes to absorb dashboard polling.
 */
import {
  CACHE_KEYS,
  CACHE_TTL,
  type EntityNode,
  type ExploreRequest,
  type SituationNode,
  sha256Hex,
} from '@ontodecide/shared';
import type { IGraphRepository } from '../repository/graph.repository.js';

export class SituationService {
  constructor(
    private readonly repo: IGraphRepository,
    private readonly cache: KVNamespace,
  ) {}

  /** Render the situation view for the root entity. */
  public async view(tenantId: string, rootId: string, depth = 1): Promise<SituationNode> {
    const cacheKey = CACHE_KEYS.situation(tenantId, await sha256Hex(`${rootId}:${depth}`));
    const cached = await this.cache.get(cacheKey, 'json');
    if (cached) {
      return cached as SituationNode;
    }
    const view = await this.repo.situationView(tenantId, rootId, depth);
    await this.cache.put(cacheKey, JSON.stringify(view), {
      expirationTtl: CACHE_TTL.SITUATION_HOT,
    });
    return view;
  }

  /** Run a 1-3 hop exploration from a root entity. */
  public async explore(tenantId: string, request: ExploreRequest): Promise<SituationNode[]> {
    return this.repo.explore(tenantId, request.entityId, request.depth ?? 2, request.relationTypes);
  }

  /** Find entities by type or attribute filter. */
  public async findEntities(
    tenantId: string,
    filter: { type?: string; attributes?: Record<string, unknown> },
    limit = 100,
  ): Promise<EntityNode[]> {
    return this.repo.findEntities(tenantId, filter, limit);
  }

  /** Read a single entity by id. */
  public async findEntity(tenantId: string, entityId: string): Promise<EntityNode | null> {
    return this.repo.findEntity(tenantId, entityId);
  }

  /** Delete a single entity (and its relations). */
  public async deleteEntity(tenantId: string, entityId: string): Promise<number> {
    return this.repo.deleteEntity(tenantId, entityId);
  }
}
