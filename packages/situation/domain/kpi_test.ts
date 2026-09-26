/**
 * @fileoverview Tests for KPI series helpers and the default layout.
 */

import {DAY_MS, HOUR_MS, MINUTE_MS} from '@ontodecide/shared-kernel';
import {describe, expect, it} from 'vitest';
import {cockpitLayoutSchema} from '../contract';
import {bucket5m, previousValue, sparkline, trend} from './kpi';
import {defaultLayout} from './layout';

const NOW = Date.parse('2026-09-24T10:02:30Z');

describe('bucket5m', () => {
  it('floors to 5 minutes', () => {
    expect(new Date(bucket5m(NOW)).toISOString()).toBe(
      '2026-09-24T10:00:00.000Z',
    );
  });
});

describe('previousValue', () => {
  it('picks the point closest to 24 h ago', () => {
    const points = [
      {ts: NOW - DAY_MS - 30 * MINUTE_MS, value: 1},
      {ts: NOW - DAY_MS + 5 * MINUTE_MS, value: 2},
      {ts: NOW - HOUR_MS, value: 3},
    ];
    expect(previousValue(points, NOW)).toBe(2);
  });

  it('returns null when nothing is within ±1 h', () => {
    expect(previousValue([{ts: NOW - HOUR_MS, value: 3}], NOW)).toBeNull();
    expect(previousValue([], NOW)).toBeNull();
  });
});

describe('sparkline', () => {
  it('keeps the last value per hour, oldest first, at most 24', () => {
    const points = [];
    for (let i = 0; i < 48 * 12; i++) {
      points.push({ts: NOW - i * 5 * MINUTE_MS, value: i});
    }
    const spark = sparkline(points, NOW);
    expect(spark.length).toBeLessThanOrEqual(25);
    expect(spark.length).toBeGreaterThanOrEqual(24);
    expect(spark[spark.length - 1]).toBe(0);
    expect(spark[0]).toBeGreaterThan(spark[1]);
  });

  it('skips hours without data', () => {
    expect(sparkline([{ts: NOW - 2 * HOUR_MS, value: 7}], NOW)).toEqual([7]);
  });
});

describe('trend', () => {
  const points = [
    {ts: NOW - 8 * DAY_MS, value: 0},
    {ts: NOW - 2 * DAY_MS, value: 1},
    {ts: NOW - 2 * DAY_MS + 5 * MINUTE_MS, value: 2},
    {ts: NOW - 10 * MINUTE_MS, value: 3},
    {ts: NOW - 5 * MINUTE_MS, value: 4},
  ];

  it('24h returns raw points in range', () => {
    expect(trend(points, '24h', NOW).map(p => p.value)).toEqual([3, 4]);
  });

  it('7d downsamples hourly', () => {
    expect(trend(points, '7d', NOW).map(p => p.value)).toEqual([2, 4]);
  });
});

describe('defaultLayout', () => {
  it('is a valid 12-column layout', () => {
    for (const ids of [[], ['k1'], ['k1', 'k2', 'k3', 'k4', 'k5']]) {
      const layout = defaultLayout(ids);
      expect(cockpitLayoutSchema.safeParse(layout).success).toBe(true);
      for (const w of layout.widgets) expect(w.x + w.w).toBeLessThanOrEqual(12);
    }
    expect(
      defaultLayout(['k1', 'k2']).widgets.filter(w => w.kind === 'kpi'),
    ).toHaveLength(2);
  });
});
