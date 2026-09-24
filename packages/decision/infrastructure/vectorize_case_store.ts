/**
 * @fileoverview Vectorize-backed case store (bge-m3 embeddings, one
 * namespace per tenant). Case rows stay in dec_case for summaries; any
 * Vectorize failure falls back to the D1 search.
 */

import type {Logger} from '@ontodecide/shared-kernel';
import type {
  CaseRecord,
  CaseStore,
  Embedder,
  SimilarCase,
} from '../application';
import type {D1CaseStore} from './d1_case_store';

/** The subset of VectorizeIndex used here. */
export interface VectorIndexLike {
  upsert(
    vectors: {
      id: string;
      values: number[];
      namespace?: string;
      metadata?: Record<string, string>;
    }[],
  ): Promise<unknown>;
  query(
    vector: number[],
    options?: {
      topK?: number;
      namespace?: string;
      returnMetadata?: 'none' | 'indexed' | 'all';
    },
  ): Promise<{matches: {id: string; score: number}[]}>;
}

/** Case store over Vectorize with D1 rows. */
export class VectorizeCaseStore implements CaseStore {
  constructor(
    private readonly index: VectorIndexLike,
    private readonly embedder: Embedder,
    private readonly rows: D1CaseStore,
    private readonly logger: Logger,
  ) {}

  async add(c: CaseRecord): Promise<void> {
    const [vector] = await this.embedder.embed([c.text]);
    // Keep the vector in D1 as well so the fallback search stays useful.
    await this.rows.add(c, vector);
    await this.index.upsert([
      {
        id: c.id,
        values: vector,
        namespace: c.tenantId,
        metadata: {tenantId: c.tenantId},
      },
    ]);
  }

  async similar(
    tenantId: string,
    text: string,
    k: number,
  ): Promise<SimilarCase[]> {
    try {
      const [vector] = await this.embedder.embed([text]);
      const res = await this.index.query(vector, {
        topK: k,
        namespace: tenantId,
        returnMetadata: 'none',
      });
      return await this.rows.byIds(
        tenantId,
        res.matches.map(m => ({id: m.id, score: m.score})),
      );
    } catch (e) {
      this.logger.warn('decision.vectorize_failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      return this.rows.similar(tenantId, text, k);
    }
  }
}
