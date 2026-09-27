/**
 * @fileoverview Isolate-memory cache of compiled workspace schemas keyed by
 * (tid, etag). No KV: a changed ontology gets a new etag, so stale entries
 * are simply never hit again and age out of the bounded LRU.
 */

import type {CompiledCache} from '../application';
import type {CompiledSchema} from '../contract';

/** Default number of cached compiled schemas per isolate. */
export const COMPILED_CACHE_SIZE = 200;

/** Bounded LRU implementation of {@link CompiledCache}. */
export class MemoryCompiledCache implements CompiledCache {
  private readonly entries = new Map<string, CompiledSchema>();

  constructor(private readonly maxEntries = COMPILED_CACHE_SIZE) {}

  get(tid: string, etag: number): CompiledSchema | undefined {
    const key = `${tid}:${etag}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(tid: string, etag: number, compiled: CompiledSchema): void {
    const key = `${tid}:${etag}`;
    this.entries.delete(key);
    this.entries.set(key, compiled);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Number of cached entries (tests). */
  get size(): number {
    return this.entries.size;
  }
}
