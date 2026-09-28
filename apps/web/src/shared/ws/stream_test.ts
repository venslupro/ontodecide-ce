/**
 * @fileoverview Cache merging of realtime frames.
 */

import {QueryClient} from '@tanstack/react-query';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import {server} from '../../test/server';
import {
  applyFrames,
  LIVE_ALERTS_MAX,
  mergeOverview,
  POLL_FRAME,
  pollOverview,
  prependById,
  registerStreamMerger,
  streamUrl,
  upsertById,
} from './stream';
import type {WsFrame} from './ws_client';

const f = (seq: number, type: string, data: unknown): WsFrame => ({
  seq,
  type,
  data,
  occurredAt: '',
});

describe('merge helpers', () => {
  it('upserts KPIs by id and prepends alerts de-duplicated, capped', () => {
    expect(
      upsertById(
        [{id: 'a', v: 1}],
        [
          {id: 'a', v: 2},
          {id: 'b', v: 3},
        ],
      ),
    ).toEqual([
      {id: 'a', v: 2},
      {id: 'b', v: 3},
    ]);
    const list = Array.from({length: LIVE_ALERTS_MAX}, (_, i) => ({
      id: `x${i}`,
    }));
    const out = prependById(list, [{id: 'new'}, {id: 'x3'}]);
    expect(out).toHaveLength(LIVE_ALERTS_MAX);
    expect(out[0].id).toBe('new');
    expect(out.filter(a => a.id === 'x3')).toHaveLength(1);
  });

  it('merges snapshot, kpi and alert frames into an overview', () => {
    const prev = {
      kpis: [{id: 'k1', value: 1}],
      alerts: [{id: 'al1'}],
      generatedAt: 'a',
    };
    const next = mergeOverview(prev, [
      f(2, 'kpi', {id: 'k1', value: 9}),
      f(3, 'alert', {id: 'al2'}),
      f(4, 'alert', {id: 'al2', status: 'ACKED'}),
    ]);
    expect(next!.kpis).toEqual([{id: 'k1', value: 9}]);
    expect(next!.alerts).toEqual([{id: 'al2', status: 'ACKED'}, {id: 'al1'}]);
    expect(mergeOverview(undefined, [f(1, 'snapshot', {kpis: []})])).toEqual({
      kpis: [],
    });
    expect(mergeOverview(undefined, [f(1, 'kpi', {id: 'k'})])).toBeUndefined();
  });

  it('builds a same-origin wss URL with the ticket', () => {
    expect(streamUrl('ws1.abc')).toBe(
      `ws://${location.host}/api/v1/situation/stream?ticket=ws1.abc`,
    );
  });
});

describe('applyFrames', () => {
  it('writes every overview query, the live alert list, and invalidates', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['situation', 'overview', '24h'], {
      kpis: [{id: 'k', value: 1}],
      alerts: [],
    });
    qc.setQueryData(['decision', 'rec', 'r1'], {id: 'r1'});
    qc.setQueryData(['me'], {email: 'x'});
    const seen: number[] = [];
    const off = registerStreamMerger((_qc, frames) => seen.push(frames.length));
    applyFrames(qc, [
      f(1, 'kpi', {id: 'k', value: 5}),
      f(2, 'alert', {id: 'a1'}),
      f(3, 'recommendation', {id: 'r1'}),
      f(4, 'trial', {}),
    ]);
    off();
    expect(qc.getQueryData(['situation', 'overview', '24h'])).toEqual({
      kpis: [{id: 'k', value: 5}],
      alerts: [{id: 'a1'}],
    });
    expect(qc.getQueryData(['situation', 'live-alerts'])).toEqual([{id: 'a1'}]);
    expect(qc.getQueryState(['decision', 'rec', 'r1'])?.isInvalidated).toBe(
      true,
    );
    expect(qc.getQueryState(['me'])?.isInvalidated).toBe(true);
    expect(seen).toEqual([4]);
  });
});

describe('polling fallback (GET /situation/overview, fanned out to followers)', () => {
  it('fetches the 24 h overview and emits it as a poll frame', async () => {
    let range: string | null = null;
    server.use(
      http.get('*/api/v1/situation/overview', ({request}) => {
        range = new URL(request.url).searchParams.get('range');
        return HttpResponse.json({kpis: [{id: 'k', value: 9}], alerts: []});
      }),
    );
    const emit = vi.fn();
    await pollOverview(emit);
    expect(range).toBe('24h');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: POLL_FRAME,
        data: {kpis: [{id: 'k', value: 9}], alerts: []},
      }),
    );
  });

  it('a poll frame (leader or follower) replaces the overview and marks lists stale', () => {
    const qc = new QueryClient();
    qc.setQueryData(['situation', 'overview'], {kpis: [], alerts: []});
    qc.setQueryData(['situation', 'overview', '7d'], {kpis: []});
    qc.setQueryData(['situation', 'alerts', {status: 'OPEN'}], {pages: []});
    qc.setQueryData(['decision', 'recs', 'Proposed'], {pages: []});
    const polled = {kpis: [{id: 'k', value: 2}], alerts: [{id: 'a9'}]};
    applyFrames(qc, [f(0, POLL_FRAME, polled)]);
    expect(qc.getQueryData(['situation', 'overview'])).toEqual(polled);
    expect(
      qc.getQueryState(['situation', 'overview', '7d'])?.isInvalidated,
    ).toBe(true);
    expect(
      qc.getQueryState(['situation', 'alerts', {status: 'OPEN'}])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      qc.getQueryState(['decision', 'recs', 'Proposed'])?.isInvalidated,
    ).toBe(true);
  });
});
