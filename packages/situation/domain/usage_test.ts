/**
 * @fileoverview Tests for usage thresholds and status.
 */

import {describe, expect, it} from 'vitest';
import {computeUsageStatus, usageThresholds} from './usage';

describe('usageThresholds', () => {
  it('defaults to 0.8 / 0.95', () => {
    expect(usageThresholds()).toEqual({warn: 0.8, stop: 0.95});
    expect(usageThresholds('abc', '')).toEqual({warn: 0.8, stop: 0.95});
  });

  it('parses vars and rejects inverted thresholds', () => {
    expect(usageThresholds('0.5', '0.9')).toEqual({warn: 0.5, stop: 0.9});
    expect(usageThresholds('0.9', '0.5')).toEqual({warn: 0.8, stop: 0.95});
  });
});

describe('computeUsageStatus', () => {
  it.each([
    [{'queues.ops': 1000}, 'ok'],
    [{'queues.ops': 8000}, 'warn'],
    [{'queues.ops': 9500}, 'stop'],
    [{'queues.ops': 100, 'kv.writes': 990}, 'stop'],
    [{}, 'ok'],
  ] as const)('%j → %s', (used, level) => {
    const s = computeUsageStatus('2026-09-24', used);
    expect(s.level).toBe(level);
    expect(s.day).toBe('2026-09-24');
  });

  it('reports ratios and honors custom thresholds', () => {
    const s = computeUsageStatus(
      '2026-09-24',
      {'workers.requests': 50_000},
      {warn: 0.4, stop: 0.6},
    );
    expect(s.ratios['workers.requests']).toBe(0.5);
    expect(s.level).toBe('warn');
  });
});
