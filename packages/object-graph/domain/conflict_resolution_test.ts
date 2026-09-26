import {describe, expect, it} from 'vitest';
import type {Provenance} from '@ontodecide/shared-kernel';
import {incomingWins, mergeProps, overwriteProps} from './conflict_resolution';
import {propsHash} from './props_hash';

const prov = (extra: Partial<Provenance> = {}): Provenance => ({
  sourceId: 's1',
  datasetTxn: 't',
  recordRef: 'r',
  ingestedAt: '2026-09-24T00:00:00Z',
  confidence: 0.5,
  ...extra,
});

describe('conflict resolution', () => {
  it('latest-wins compares sourceTs, falling back to ingestedAt', () => {
    const old = prov({sourceTs: '2026-09-20T00:00:00Z'});
    expect(
      incomingWins(
        'latest-wins',
        old,
        prov({sourceTs: '2026-09-21T00:00:00Z'}),
      ),
    ).toBe(true);
    expect(
      incomingWins(
        'latest-wins',
        old,
        prov({sourceTs: '2026-09-19T00:00:00Z'}),
      ),
    ).toBe(false);
    // No sourceTs on either side: ingestion time decides.
    expect(
      incomingWins(
        'latest-wins',
        prov({ingestedAt: '2026-09-24T01:00:00Z'}),
        prov(),
      ),
    ).toBe(false);
    expect(incomingWins('latest-wins', undefined, prov())).toBe(true);
  });

  it('source-priority lets the higher priority win, ties fall back to latest', () => {
    const low = prov({priority: 1});
    const high = prov({priority: 5});
    expect(incomingWins('source-priority', high, low)).toBe(false);
    expect(incomingWins('source-priority', low, high)).toBe(true);
    const merged = mergeProps(
      {props: {riskScore: 10}, provenance: {riskScore: high}, history: {}},
      {riskScore: 99, country: 'CN'},
      low,
      'source-priority',
    );
    expect(merged.state.props).toEqual({riskScore: 10, country: 'CN'});
    expect(merged.changed).toEqual(['country']);
  });

  it('source-priority: null incoming values never overwrite', () => {
    const merged = mergeProps(
      {props: {a: 1}, provenance: {a: prov({priority: 1})}, history: {}},
      {a: null},
      prov({priority: 9}),
      'source-priority',
    );
    expect(merged.state.props.a).toBe(1);
    expect(merged.changed).toEqual([]);
  });

  it('max-confidence keeps the more confident value', () => {
    const cur = {
      props: {a: 1},
      provenance: {a: prov({confidence: 0.9})},
      history: {},
    };
    expect(
      mergeProps(cur, {a: 2}, prov({confidence: 0.5}), 'max-confidence')
        .changed,
    ).toEqual([]);
    const won = mergeProps(
      cur,
      {a: 2},
      prov({confidence: 0.95}),
      'max-confidence',
    );
    expect(won.state.props.a).toBe(2);
    expect(won.state.history.a[0]).toMatchObject({value: 1, confidence: 0.9});
  });

  it('records overwritten values newest first, capped at 5', () => {
    let state = {props: {}, provenance: {}, history: {}} as Parameters<
      typeof mergeProps
    >[0];
    for (let i = 0; i < 8; i++) {
      const out = mergeProps(
        state,
        {v: i},
        prov({ingestedAt: `2026-09-24T00:00:0${i}Z`, recordRef: `r${i}`}),
        'latest-wins',
      );
      state = out.state;
    }
    expect(state!.props.v).toBe(7);
    const h = state!.history.v;
    expect(h).toHaveLength(5);
    expect(h.map(x => x.value)).toEqual([6, 5, 4, 3, 2]);
  });

  it('equal values are not changes', () => {
    const cur = {
      props: {geo: {lat: 1, lon: 2}},
      provenance: {geo: prov()},
      history: {},
    };
    expect(
      mergeProps(cur, {geo: {lon: 2, lat: 1}}, prov(), 'latest-wins').changed,
    ).toEqual([]);
  });

  it('overwriteProps sets values unconditionally with history', () => {
    const cur = {
      props: {status: 'active'},
      provenance: {status: prov()},
      history: {},
    };
    const out = overwriteProps(
      cur,
      {status: 'watch'},
      prov({sourceId: 'action:flag'}),
    );
    expect(out.changed).toEqual(['status']);
    expect(out.state.provenance.status.sourceId).toBe('action:flag');
    expect(out.state.history.status[0].value).toBe('active');
  });
});

describe('propsHash', () => {
  it('is stable under key order and sensitive to values', async () => {
    const a = await propsHash({x: 1, y: {b: 2, a: 1}});
    const b = await propsHash({y: {a: 1, b: 2}, x: 1});
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await propsHash({x: 2, y: {a: 1, b: 2}})).not.toBe(a);
  });
});
