/**
 * @fileoverview Tests for EdgeGuardCore and the token bucket math.
 */

import {DAY_MS} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import {MemorySqlStorage} from '@ontodecide/testing';
import {EdgeGuardCore} from './edge_guard_core';
import {MemoryRateLimiter} from './rate_limiter';

const T0 = Date.parse('2026-09-24T00:00:00Z');

describe('EdgeGuardCore', () => {
  it('stores and returns idempotent responses (first writer wins)', () => {
    let now = T0;
    const core = new EdgeGuardCore(new MemorySqlStorage(), () => now);
    expect(core.getIdempotent('k')).toBeNull();
    core.putIdempotent('k', 202, '{"jobId":"j1"}');
    core.putIdempotent('k', 200, '{"other":true}');
    expect(core.getIdempotent('k')).toEqual({
      status: 202,
      body: '{"jobId":"j1"}',
      createdAt: T0,
    });
    now = T0 + DAY_MS + 1;
    expect(core.getIdempotent('k')).toBeNull();
  });

  it('cleans up records older than 24 h', () => {
    const sql = new MemorySqlStorage();
    let now = T0;
    const core = new EdgeGuardCore(sql, () => now);
    core.putIdempotent('old', 200, '{}');
    core.take('b', 5, 1, now);
    now = T0 + DAY_MS / 2;
    core.putIdempotent('new', 200, '{}');
    core.cleanup(T0 + DAY_MS + 10);
    expect(sql.exec('SELECT key FROM idem').toArray()).toEqual([{key: 'new'}]);
    expect(sql.exec('SELECT bucket FROM rate').toArray()).toEqual([]);
  });

  it('counts tokens precisely and refills over time', () => {
    const core = new EdgeGuardCore(new MemorySqlStorage(), () => T0);
    for (let i = 0; i < 3; i++) expect(core.take('b', 3, 1, T0).ok).toBe(true);
    const denied = core.take('b', 3, 1, T0);
    expect(denied).toMatchObject({ok: false, retryAfterSec: 1});
    expect(core.take('b', 3, 1, T0 + 1000).ok).toBe(true);
  });
});

describe('MemoryRateLimiter', () => {
  it('limits per key with retry-after', () => {
    const l = new MemoryRateLimiter();
    const spec = {capacity: 2, refillPerSec: 0.5};
    expect(l.take('a', spec, T0).ok).toBe(true);
    expect(l.take('a', spec, T0).ok).toBe(true);
    expect(l.take('a', spec, T0)).toMatchObject({ok: false, retryAfterSec: 2});
    expect(l.take('b', spec, T0).ok).toBe(true);
  });

  it('evicts the least recently used bucket beyond the cap', () => {
    const l = new MemoryRateLimiter(2);
    const spec = {capacity: 1, refillPerSec: 0.001};
    l.take('a', spec, T0);
    l.take('b', spec, T0);
    l.take('c', spec, T0);
    // 'a' was evicted, so it starts full again.
    expect(l.take('a', spec, T0).ok).toBe(true);
  });
});
