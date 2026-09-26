/**
 * @fileoverview Embedders: Workers AI bge-m3 and a deterministic hashing
 * embedder for tests and local development.
 */

import type {Embedder} from '../../application';
import {tokenize} from '../../domain';
import type {AiRunner} from './workers_ai_llm';

/** Workers AI embedding model. */
export const EMBEDDING_MODEL = '@cf/baai/bge-m3';

/** Workers AI bge-m3 embedder. */
export class WorkersAiEmbedder implements Embedder {
  readonly model = EMBEDDING_MODEL;

  constructor(private readonly ai: AiRunner) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out = (await this.ai.run(this.model, {text: texts})) as {
      data?: number[][];
    };
    if (!Array.isArray(out?.data) || out.data.length !== texts.length) {
      throw new Error('bge-m3 returned no embeddings');
    }
    return out.data;
  }
}

/** Bag-of-words hashing embedder (deterministic, normalized). */
export class FakeEmbedder implements Embedder {
  readonly model = 'fake-embedder';

  constructor(private readonly dim = 64) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(t => {
      const v = new Array<number>(this.dim).fill(0);
      for (const tok of tokenize(t)) {
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) {
          h ^= tok.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        v[(h >>> 0) % this.dim] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map(x => x / norm);
    });
  }
}
