/**
 * @fileoverview Tests of the isolate-memory compiled-schema cache.
 */

import {describe, expect, it} from 'vitest';
import type {CompiledSchema} from '../contract';
import {MemoryCompiledCache} from './schema_cache';

const schema = (etag: number) => ({etag}) as unknown as CompiledSchema;

describe('MemoryCompiledCache', () => {
  it('keys entries by (tid, etag)', () => {
    const cache = new MemoryCompiledCache();
    cache.set('t1', 1, schema(1));
    expect(cache.get('t1', 1)?.etag).toBe(1);
    expect(cache.get('t1', 2)).toBeUndefined();
    expect(cache.get('t2', 1)).toBeUndefined();
  });

  it('evicts the least recently used entry', () => {
    const cache = new MemoryCompiledCache(2);
    cache.set('a', 1, schema(1));
    cache.set('b', 1, schema(1));
    cache.get('a', 1);
    cache.set('c', 1, schema(1));
    expect(cache.size).toBe(2);
    expect(cache.get('a', 1)).toBeDefined();
    expect(cache.get('b', 1)).toBeUndefined();
  });
});
