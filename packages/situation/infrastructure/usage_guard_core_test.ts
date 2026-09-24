/**
 * @fileoverview Tests for UsageGuardCore: accumulation, levels, rollover.
 */

import {
  DAY_MS,
  FixedClock,
  type UsageResource,
} from '@ontodecide/shared-kernel';
import {MemorySqlStorage} from '@ontodecide/testing';
import {describe, expect, it} from 'vitest';
import {UsageGuardCore} from './usage_guard_core';

describe('UsageGuardCore', () => {
  it('accumulates per resource and day', async () => {
    const guard = new UsageGuardCore(new MemorySqlStorage(), {
      clock: new FixedClock('2026-09-24T10:00:00Z'),
    });
    await guard.record([{resource: 'queues.ops', n: 100}]);
    const s = await guard.record([
      {resource: 'queues.ops', n: 50},
      {resource: 'd1.rowsWritten', n: 10},
      {resource: 'bogus' as UsageResource, n: 5},
      {resource: 'kv.writes', n: -3},
    ]);
    expect(s.day).toBe('2026-09-24');
    expect(s.used).toEqual({'queues.ops': 150, 'd1.rowsWritten': 10});
    expect(s.ratios['queues.ops']).toBeCloseTo(0.015);
    expect(s.level).toBe('ok');
  });

  it('computes levels with configured thresholds', async () => {
    const guard = new UsageGuardCore(new MemorySqlStorage(), {
      clock: new FixedClock(),
      thresholds: {warn: 0.5, stop: 0.9},
    });
    expect((await guard.record([{resource: 'kv.writes', n: 600}])).level).toBe(
      'warn',
    );
    expect((await guard.record([{resource: 'kv.writes', n: 300}])).level).toBe(
      'stop',
    );
    expect((await guard.status()).level).toBe('stop');
  });

  it('persists previous days on rollover and starts fresh', async () => {
    const clock = new FixedClock('2026-09-24T23:59:00Z');
    const saved: [string, Record<string, number>][] = [];
    const guard = new UsageGuardCore(new MemorySqlStorage(), {
      clock,
      onRollover: async (day, used) => {
        saved.push([day, used as Record<string, number>]);
      },
    });
    await guard.record([{resource: 'ai.neurons', n: 9000}]);
    expect((await guard.status()).level).toBe('warn');
    clock.advance(DAY_MS);
    const s = await guard.status();
    expect(s.day).toBe('2026-09-25');
    expect(s.used).toEqual({});
    expect(s.level).toBe('ok');
    expect(saved).toEqual([['2026-09-24', {'ai.neurons': 9000}]]);
  });

  it('keeps the day when the sink fails and retries later', async () => {
    const clock = new FixedClock('2026-09-24T12:00:00Z');
    let fail = true;
    const saved: string[] = [];
    const guard = new UsageGuardCore(new MemorySqlStorage(), {
      clock,
      onRollover: async day => {
        if (fail) throw new Error('d1 down');
        saved.push(day);
      },
    });
    await guard.record([{resource: 'queues.ops', n: 1}]);
    clock.advance(DAY_MS);
    await guard.status();
    expect(saved).toEqual([]);
    fail = false;
    await guard.record([{resource: 'queues.ops', n: 1}]);
    expect(saved).toEqual(['2026-09-24']);
    expect((await guard.status()).used).toEqual({'queues.ops': 1});
  });
});
