/**
 * @fileoverview Situation view model: recommendation frame merge, KPI
 * deltas, alert ordering and markers, empty-workspace detection, and the
 * registered stream merger writing into the overview cache.
 */

import {QueryClient} from '@tanstack/react-query';
import {describe, expect, it} from 'vitest';
import {
  makeAlerts,
  makeKpis,
  makeOverview,
  makeRecommendations,
  S017,
} from '../../test/fixtures/business';
import {situationKeys} from './api';
import {
  alertMarkers,
  isEmptyWorkspace,
  kpiDelta,
  kpiOffTarget,
  kpiTrendIsGood,
  mergeRecommendationFrames,
  recImpact,
  sortAlertsBySeverity,
  trendOf,
  type OverviewView,
} from './model';
import {recommendationMerger} from './stream';

function overview(): OverviewView {
  return {
    ...makeOverview(),
    pendingRecommendations: makeRecommendations().slice(0, 2),
  };
}

const summary = (id: string, status: string) => ({
  id,
  status,
  summary: `rec ${id}`,
  confidence: 0.5,
  rankedBy: 'rules' as const,
  focus: S017,
  expectedImpact: 0.1,
  createdAt: '2026-09-28T09:00:00Z',
  expiresAt: '2026-09-29T09:00:00Z',
});

describe('mergeRecommendationFrames', () => {
  it('prepends new Proposed items and removes decided ones', () => {
    const next = mergeRecommendationFrames(overview(), [
      {type: 'recommendation', data: summary('rec-9', 'Proposed')},
      {type: 'recommendation', data: [summary('rec-203', 'Executed')]},
    ])!;
    expect(next.pendingRecommendations!.map(r => r.id)).toEqual([
      'rec-9',
      'rec-204',
    ]);
  });

  it('deduplicates by id and ignores other frame types', () => {
    const prev = overview();
    const same = mergeRecommendationFrames(prev, [{type: 'kpi', data: []}]);
    expect(same).toBe(prev);
    const twice = mergeRecommendationFrames(prev, [
      {type: 'recommendation', data: summary('rec-204', 'Proposed')},
      {type: 'recommendation', data: summary('rec-204', 'Proposed')},
    ])!;
    expect(
      twice.pendingRecommendations!.filter(r => r.id === 'rec-204'),
    ).toHaveLength(1);
  });

  it('takes impacted objects from the newest simulation', () => {
    const impacted = [
      {rid: S017, type: 'Supplier', title: 'x', delta: -0.5, hop: 0},
    ];
    const next = mergeRecommendationFrames(overview(), [
      {
        type: 'recommendation',
        data: {...summary('rec-9', 'Proposed'), impacted},
      },
    ])!;
    expect(next.impacted).toEqual(impacted);
  });

  it('keeps an absent cache absent', () => {
    expect(mergeRecommendationFrames(undefined, [])).toBeUndefined();
  });
});

describe('recommendationMerger', () => {
  it('updates every overview range in the cache', () => {
    const qc = new QueryClient();
    qc.setQueryData(situationKeys.overview('24h'), overview());
    qc.setQueryData(situationKeys.overview('7d'), overview());
    recommendationMerger(qc, [
      {
        seq: 1,
        type: 'recommendation',
        data: summary('rec-9', 'Proposed'),
        occurredAt: '',
      },
    ]);
    for (const r of ['24h', '7d'] as const) {
      const ov = qc.getQueryData<OverviewView>(situationKeys.overview(r))!;
      expect(ov.pendingRecommendations![0].id).toBe('rec-9');
    }
  });
});

describe('KPI helpers', () => {
  const [otd, shortage, flat] = makeKpis();
  it('computes deltas and direction', () => {
    expect(kpiDelta(otd)!.abs).toBeCloseTo(-2.1);
    expect(kpiTrendIsGood(otd)).toBe(false);
    expect(kpiTrendIsGood(shortage)).toBe(false);
    expect(kpiTrendIsGood(flat)).toBeNull();
    expect(kpiDelta({value: null, previous: 1})).toBeNull();
    expect(kpiDelta({value: 2, previous: 0})!.rel).toBeNull();
  });

  it('detects missed targets', () => {
    expect(kpiOffTarget(otd)).toBe(true);
    expect(kpiOffTarget({...otd, value: 96})).toBe(false);
    expect(kpiOffTarget(shortage)).toBe(false);
  });

  it('finds trend points', () => {
    expect(trendOf(makeOverview().trends, 'otd')).toHaveLength(12);
    expect(trendOf(undefined, 'otd')).toEqual([]);
  });
});

describe('alerts', () => {
  it('sorts by severity then recency', () => {
    const list = [...makeAlerts()].reverse();
    expect(sortAlertsBySeverity(list).map(a => a.severity)).toEqual([
      'CRITICAL',
      'HIGH',
      'MEDIUM',
    ]);
  });

  it('builds markers inside the window', () => {
    const from = Date.parse('2026-09-28T09:35:00Z');
    expect(alertMarkers(makeAlerts(), from).map(m => m.title)).toEqual([
      '供应商 S-017 产能下降 60%',
      '物料 M-2231 低于安全库存',
    ]);
  });
});

describe('misc', () => {
  it('reads the expected impact of a pending recommendation', () => {
    const [rec] = makeRecommendations();
    expect(recImpact(rec)).toBe(0.12);
    expect(recImpact({...rec, expectedImpact: 0.3})).toBe(0.3);
    expect(recImpact({...rec, candidates: [], ranking: []})).toBeNull();
  });

  it('detects an empty workspace', () => {
    expect(isEmptyWorkspace(undefined, 0)).toBe(true);
    expect(isEmptyWorkspace(makeOverview(), 11)).toBe(false);
    expect(isEmptyWorkspace({kpis: [], alerts: []}, undefined)).toBe(true);
  });
});
