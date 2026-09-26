/**
 * @fileoverview Tests for the memory LRU and the tiered schema cache.
 */

import {FixedClock, silentLogger} from '@ontodecide/shared-kernel';
import {MemoryKV} from '@ontodecide/testing';
import {describe, expect, it} from 'vitest';
import {SUPPLY_CHAIN_PACK, compileSchema, mergeModel} from '../domain';
import {
  LruCache,
  TieredSchemaCache,
  modelKvKey,
  schemaKvKey,
} from './schema_cache';

describe('LruCache', () => {
  it('evicts the least recently used entry and honours TTLs', () => {
    const clock = new FixedClock();
    const lru = new LruCache<number>(clock, 2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1);
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    lru.set('t', 4, 1000);
    clock.advance(1001);
    expect(lru.get('t')).toBeUndefined();
    expect(lru.size).toBe(1);
  });
});

describe('TieredSchemaCache', () => {
  it('writes KV only on publish and reads through memory → KV', async () => {
    const clock = new FixedClock();
    const kv = new MemoryKV();
    const cache = new TieredSchemaCache(kv.asKV(), clock, silentLogger);
    const compiled = await compileSchema(SUPPLY_CHAIN_PACK.schema, '1.0.0');
    const model = await mergeModel('t1', [compiled]);

    cache.putModel('t1', model);
    cache.putSchema('t1', 'current', compiled);
    expect(kv.writes).toBe(0);

    await cache.onPublish('t1', compiled, model);
    expect(kv.writes).toBe(2);
    expect([...kv.data.keys()].sort()).toEqual([
      modelKvKey('t1'),
      schemaKvKey('t1', 'supplyChain'),
    ]);

    const fresh = new TieredSchemaCache(kv.asKV(), clock, silentLogger);
    expect((await fresh.getModel('t1'))?.version).toBe('supplyChain@1.0.0');
    expect((await fresh.getSchema('t1', 'supplyChain', 'current'))?.hash).toBe(
      compiled.hash,
    );
    expect(await fresh.getSchema('t1', 'supplyChain', '1.0.0')).toBeNull();
    expect(await fresh.getModel('t2')).toBeNull();
  });
});
