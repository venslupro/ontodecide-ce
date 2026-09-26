/**
 * @fileoverview Tests for SituationRoomCore: sequencing, replay window and
 * snapshot fallback.
 */

import {FixedClock} from '@ontodecide/shared-kernel';
import {MemorySqlStorage} from '@ontodecide/testing';
import {describe, expect, it} from 'vitest';
import type {AlertDto, WsMsg} from '../contract';
import {
  PONG_FRAME,
  type RoomSnapshot,
  SituationRoomCore,
  WS_REPLAY_WINDOW,
  parseLastSeq,
} from './situation_room_core';

function alert(id: string, over: Partial<AlertDto> = {}): AlertDto {
  return {
    id,
    automationId: 'a1',
    automationName: 'rule',
    rid: 'ri.t1.Supplier.S1',
    title: 'Acme',
    severity: 'HIGH',
    status: 'OPEN',
    snapshot: {},
    hits: 1,
    raisedAt: '2026-09-24T00:00:00.000Z',
    ...over,
  };
}

function room() {
  const frames: string[] = [];
  const core = new SituationRoomCore(
    new MemorySqlStorage(),
    {broadcast: f => frames.push(f)},
    new FixedClock(),
  );
  return {core, frames};
}

describe('SituationRoomCore', () => {
  it('assigns increasing seq and broadcasts each message', async () => {
    const {core, frames} = room();
    const a = await core.publish('kpi', {id: 'k1', value: 1});
    const b = await core.publish('usage', {level: 'ok'});
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(frames.map(f => (JSON.parse(f) as WsMsg).seq)).toEqual([1, 2]);
    expect(core.currentSeq()).toBe(2);
  });

  it('replays missed messages within the window', async () => {
    const {core} = room();
    for (let i = 0; i < 5; i++) await core.publish('kpi', {id: 'k1', value: i});
    expect((await core.since(2))!.map(m => m.seq)).toEqual([3, 4, 5]);
    expect(await core.since(5)).toEqual([]);
    expect(await core.since(6)).toBeNull();
    expect(await core.since(-1)).toBeNull();
  });

  it('returns null when the gap exceeds the retained window', async () => {
    const {core} = room();
    const total = WS_REPLAY_WINDOW + 10;
    for (let i = 0; i < total; i++) await core.publish('usage', {i});
    expect(await core.since(total - WS_REPLAY_WINDOW)).toHaveLength(
      WS_REPLAY_WINDOW,
    );
    expect(await core.since(total - WS_REPLAY_WINDOW - 1)).toBeNull();
    expect(await core.since(0)).toBeNull();
  });

  it('keeps live KPIs and open alerts for snapshots', async () => {
    const {core} = room();
    await core.publish('kpi', {id: 'k1', value: 1});
    await core.publish('kpi', {id: 'k2', value: 2});
    await core.publish('kpi', {id: 'k1', value: 3});
    await core.publish('kpi', {id: 'k2', deleted: true});
    await core.publish('alert', alert('x1', {severity: 'LOW'}));
    await core.publish('alert', alert('x2', {severity: 'CRITICAL'}));
    await core.publish('alert', alert('x3'));
    await core.publish('alert', alert('x3', {status: 'CLOSED'}));
    const snap = await core.snapshot();
    expect(snap.type).toBe('snapshot');
    expect(snap.seq).toBe(8);
    const data = snap.data as RoomSnapshot;
    expect(data.kpis).toEqual([{id: 'k1', value: 3}]);
    expect(data.alerts.map(a => a.id)).toEqual(['x2', 'x1']);
  });

  it('connect replays or falls back to a snapshot', async () => {
    const {core} = room();
    await core.publish('kpi', {id: 'k1', value: 1});
    await core.publish('kpi', {id: 'k1', value: 2});
    expect((await core.connect(1)).map(m => m.type)).toEqual(['kpi']);
    expect((await core.connect(null)).map(m => m.type)).toEqual(['snapshot']);
    expect((await core.connect(99)).map(m => m.type)).toEqual(['snapshot']);
  });

  it('handles client frames', async () => {
    const {core} = room();
    await core.publish('kpi', {id: 'k1', value: 1});
    expect(await core.handleFrame('{"type":"ping"}')).toEqual([PONG_FRAME]);
    expect(await core.handleFrame('{"type":"resume","lastSeq":0}')).toEqual([
      expect.objectContaining({seq: 1, type: 'kpi'}),
    ]);
    expect(
      ((await core.handleFrame('{"type":"resume"}')) as WsMsg[])[0].type,
    ).toBe('snapshot');
    expect(await core.handleFrame('not json')).toEqual([]);
    expect(await core.handleFrame('{"type":"other"}')).toEqual([]);
  });

  it('persists seq across instances over the same storage', async () => {
    const sql = new MemorySqlStorage();
    await new SituationRoomCore(sql).publish('usage', {});
    const again = new SituationRoomCore(sql);
    expect((await again.publish('usage', {})).seq).toBe(2);
  });

  it('parseLastSeq', () => {
    expect(parseLastSeq('https://x/s?lastSeq=12')).toBe(12);
    expect(parseLastSeq('https://x/s?lastSeq=abc')).toBeNull();
    expect(parseLastSeq('https://x/s')).toBeNull();
  });
});
