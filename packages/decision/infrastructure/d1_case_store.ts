/**
 * @fileoverview dec_case store: the free-tier fallback for case recall.
 * With an embedder, embeddings are stored as JSON and searched by
 * brute-force cosine; without one, keyword (Jaccard) similarity is used.
 */

import {parseJson} from '@ontodecide/shared-kernel';
import type {
  CaseRecord,
  CaseStore,
  Embedder,
  SimilarCase,
} from '../application';
import {cosine, keywordSimilarity} from '../domain';

interface Row {
  id: string;
  summary: string;
  outcome: string | null;
  embedding: string | null;
}

/** Cases scanned per query (newest first). */
const SCAN_LIMIT = 200;

/** Stored text and vector (the vector may be absent). */
interface StoredEmbedding {
  text: string;
  vector?: number[];
}

/** D1-backed case store. */
export class D1CaseStore implements CaseStore {
  constructor(
    private readonly db: D1Database,
    private readonly embedder: Embedder | null = null,
  ) {}

  async add(c: CaseRecord, vector?: number[]): Promise<void> {
    let v = vector;
    if (!v && this.embedder) {
      try {
        [v] = await this.embedder.embed([c.text]);
      } catch {
        v = undefined;
      }
    }
    const stored: StoredEmbedding = {text: c.text, ...(v ? {vector: v} : {})};
    await this.db
      .prepare(
        `INSERT INTO dec_case (id, tenant_id, summary, outcome, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET summary = excluded.summary, outcome = excluded.outcome,
           embedding = excluded.embedding`,
      )
      .bind(
        c.id,
        c.tenantId,
        c.summary,
        c.outcome ? JSON.stringify(c.outcome) : null,
        JSON.stringify(stored),
        c.createdAt,
      )
      .run();
  }

  async similar(
    tenantId: string,
    text: string,
    k: number,
  ): Promise<SimilarCase[]> {
    const {results} = await this.db
      .prepare(
        'SELECT id, summary, outcome, embedding FROM dec_case WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .bind(tenantId, SCAN_LIMIT)
      .all<Row>();
    if (results.length === 0) return [];
    let query: number[] | undefined;
    if (this.embedder) {
      try {
        [query] = await this.embedder.embed([text]);
      } catch {
        query = undefined;
      }
    }
    const scored = results.map(r => {
      const e = parseJson<StoredEmbedding>(r.embedding, {text: r.summary});
      const score =
        query && e.vector
          ? cosine(query, e.vector)
          : keywordSimilarity(text, e.text || r.summary);
      return {r, score};
    });
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({r, score}) => toSimilar(r, score));
  }

  /** Loads cases by id (Vectorize hits) preserving the given order. */
  async byIds(
    tenantId: string,
    ids: {id: string; score: number}[],
  ): Promise<SimilarCase[]> {
    if (ids.length === 0) return [];
    const {results} = await this.db
      .prepare(
        `SELECT id, summary, outcome, embedding FROM dec_case WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      )
      .bind(tenantId, ...ids.map(i => i.id))
      .all<Row>();
    const byId = new Map(results.map(r => [r.id, r]));
    return ids
      .filter(i => byId.has(i.id))
      .map(i => toSimilar(byId.get(i.id)!, i.score));
  }
}

function toSimilar(r: Row, score: number): SimilarCase {
  const outcome = parseJson<SimilarCase['outcome'] | null>(r.outcome, null);
  return {
    id: r.id,
    summary: r.summary,
    ...(outcome ? {outcome} : {}),
    score: Math.round(score * 10_000) / 10_000,
  };
}
