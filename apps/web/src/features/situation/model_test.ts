/**
 * @fileoverview Realtime increment merge (KPIs overwrite, alerts dedupe
 * newest-first keep 200, recommendations invalidate) and the ≤ 1/s
 * rAF-throttled application to the query cache.
 */

import type {AlertDto, WsMsg} from '@ontodecide/situation/contract';
import {QueryClient} from '@tanstack/react-query';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {qk} from '../../shared/api/query_keys';
import {createFrameBatcher} from '../../shared/lib/frame_batcher';
import {alerts, kpis, overview, recSummaries, usage} from '../../test/fixtures';
import {
  ALERT_KEEP,
  kpiDelta,
  kpiOffTarget,
  kpiTrendIsGood,
  mergeFrames,
  type Overview,
} from './model';
import {applyFrames, useRealtimeStatus} from './stream';

let seq = 0;
const frame = (type: WsMsg['type'], data: unknown): WsMsg => ({
  seq: ++seq,
  type,
  data,
  occurredAt: new Date().toISOString(),
});
const alert = (
  id: string,
  raisedAt: string,
  extra: Partial<AlertDto> = {},
): AlertDto => ({...alerts[0], id, raisedAt, ...extra});

describe('mergeFrames', () => {
  it('overwrites KPIs by id and keeps order', () => {
    const r = mergeFrames(overview, [
      frame('kpi', {...kpis[1], value: 50}),
      frame('kpi', {...kpis[1], value: 52}),
    ]);
    expect(r.overview!.kpis.map(k => k.id)).toEqual(
      overview.kpis.map(k => k.id),
    );
    expect(r.overview!.kpis[1].value).toBe(52);
    expect(r.overview!.kpis[0]).toBe(overview.kpis[0]);
  });

  it('appends unknown KPIs and accepts arrays', () => {
    const r = mergeFrames(overview, [
      frame('kpi', [{...kpis[0], id: 'kpi-new', value: 1}]),
    ]);
    expect(r.overview!.kpis.at(-1)!.id).toBe('kpi-new');
  });

  it('dedupes alerts by id, newest first, and reports new ids', () => {
    const updated = {...alerts[0], hits: 5};
    const fresh = alert('al-new', '2026-09-24T07:59:00.000Z');
    const r = mergeFrames(overview, [
      frame('alert', updated),
      frame('alert', fresh),
    ]);
    const ids = r.overview!.alerts.map(a => a.id);
    expect(ids[0]).toBe('al-new');
    expect(ids.filter(i => i === alerts[0].id)).toHaveLength(1);
    expect(r.overview!.alerts.find(a => a.id === alerts[0].id)!.hits).toBe(5);
    expect(r.newAlertIds).toEqual(['al-new']);
  });

  it('keeps at most 200 alerts', () => {
    const many = Array.from({length: 250}, (_, i) =>
      alert(`a${i}`, new Date(Date.UTC(2026, 8, 24, 0, i)).toISOString()),
    );
    const r = mergeFrames({...overview, alerts: []}, [frame('alert', many)]);
    expect(r.overview!.alerts).toHaveLength(ALERT_KEEP);
    expect(r.overview!.alerts[0].id).toBe('a249');
  });

  it('collects recommendation ids to invalidate and updates the pending list', () => {
    const r = mergeFrames(overview, [
      frame('recommendation', {...recSummaries[0], status: 'Executed'}),
      frame('recommendation', {
        ...recSummaries[0],
        id: 'rec-2',
        status: 'Proposed',
      }),
    ]);
    expect(r.invalidateRecs.sort()).toEqual(['rec-1', 'rec-2']);
    expect(r.overview!.recommendations.map(x => x.id)).toEqual(['rec-2']);
  });

  it('replaces the cache on snapshot and keeps data health', () => {
    const snap: Overview = {
      ...overview,
      kpis: [],
      alerts: [],
      dataHealth: undefined,
    };
    const r = mergeFrames(overview, [
      frame('kpi', kpis[0]),
      frame('snapshot', snap),
    ]);
    expect(r.replaced).toBe(true);
    expect(r.overview!.kpis).toEqual([]);
    expect(r.overview!.dataHealth).toEqual(overview.dataHealth);
  });

  it('merges a SituationRoom snapshot ({kpis, alerts} only) over the overview', () => {
    const r = mergeFrames(overview, [
      frame('snapshot', {kpis: [kpis[0]], alerts: []}),
    ]);
    expect(r.overview!.kpis).toEqual([kpis[0]]);
    expect(r.overview!.alerts).toEqual([]);
    expect(r.overview!.recommendations).toEqual(overview.recommendations);
    expect(r.overview!.usage).toEqual(overview.usage);
    expect(
      mergeFrames(undefined, [frame('snapshot', {kpis: []})]).overview,
    ).toMatchObject({alerts: [], recommendations: []});
  });

  it('extracts usage', () => {
    const u = {...usage, level: 'stop' as const};
    const r = mergeFrames(overview, [frame('usage', u)]);
    expect(r.usage).toEqual(u);
    expect(r.overview!.usage).toEqual(u);
  });

  it('ignores increments before the first overview load', () => {
    const r = mergeFrames(undefined, [
      frame('kpi', kpis[0]),
      frame('alert', alerts[0]),
    ]);
    expect(r.overview).toBeUndefined();
  });
});

describe('KPI helpers', () => {
  it('computes delta and direction', () => {
    expect(kpiDelta({value: 45.8, previous: 41.2})!.abs).toBeCloseTo(4.6);
    expect(kpiDelta({value: 1, previous: null})).toBeNull();
    expect(
      kpiTrendIsGood({value: 50, previous: 40, higherIsBetter: false}),
    ).toBe(false);
    expect(
      kpiTrendIsGood({value: 50, previous: 40, higherIsBetter: true}),
    ).toBe(true);
    expect(
      kpiTrendIsGood({value: 40, previous: 40, higherIsBetter: true}),
    ).toBeNull();
    expect(kpiOffTarget({value: 45, target: 40, higherIsBetter: false})).toBe(
      true,
    );
    expect(kpiOffTarget({value: 45, target: null, higherIsBetter: false})).toBe(
      false,
    );
  });
});

describe('throttled application', () => {
  afterEach(() => vi.useRealTimers());

  it('flushes at most once per second inside rAF, merging bursts', () => {
    vi.useFakeTimers();
    const env = {
      now: () => Date.now(),
      raf: (cb: () => void) => setTimeout(cb, 16),
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    };
    const flushes: number[] = [];
    const b = createFrameBatcher<number>(
      items => flushes.push(items.length),
      1000,
      env,
    );
    for (let i = 0; i < 50; i++) b.push(i);
    vi.advanceTimersByTime(20);
    expect(flushes).toEqual([50]);
    for (let i = 0; i < 10; i++) {
      b.push(i);
      vi.advanceTimersByTime(50);
    }
    // Still inside the 1 s window after the first flush → nothing yet.
    expect(flushes).toEqual([50]);
    vi.advanceTimersByTime(600);
    expect(flushes).toEqual([50, 10]);
    b.dispose();
  });

  it('writes merged frames into the query cache and invalidates recommendations', () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.overview(), overview);
    qc.setQueryData(qk.recommendation('rec-1'), {id: 'rec-1'});
    applyFrames(qc, [
      frame('kpi', {...kpis[0], value: 9}),
      frame('alert', alert('al-x', '2026-09-24T07:59:30.000Z')),
      frame('recommendation', {...recSummaries[0], status: 'Approved'}),
    ]);
    const ov = qc.getQueryData<Overview>(qk.overview())!;
    expect(ov.kpis[0].value).toBe(9);
    expect(ov.alerts[0].id).toBe('al-x');
    expect(qc.getQueryState(qk.recommendation('rec-1'))!.isInvalidated).toBe(
      true,
    );
    expect(useRealtimeStatus.getState().newAlertIds).toEqual(['al-x']);
  });
});
