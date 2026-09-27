/**
 * @fileoverview Tests of stream tickets, client frames, resume planning and
 * the per-user connection cap.
 */

import {describe, expect, it} from 'vitest';
import {
  formatTicket,
  parseClientFrame,
  planResume,
  socketsToEvict,
  ticketTid,
} from './stream';

const TID = '01K6A000000000000000000T01';

describe('tickets', () => {
  it('routes by the tid prefix', () => {
    const t = formatTicket(TID, 'abcdefghijklmnopqrstuvwxyz012345');
    expect(ticketTid(t)).toBe(TID);
  });

  it('rejects malformed tickets', () => {
    for (const t of [
      null,
      '',
      TID,
      `${TID}.`,
      `${TID}.short`,
      'not-a-ulid.abcdefghijklmnopqrstuvwxyz',
      `${TID}.abc/def+ghijklmnopqrstuv`,
      `${TID}.${'a'.repeat(200)}`,
    ]) {
      expect(ticketTid(t)).toBeNull();
    }
  });
});

describe('parseClientFrame', () => {
  it('accepts resume frames only', () => {
    expect(parseClientFrame('{"type":"resume","lastSeq":7}')).toEqual({
      type: 'resume',
      lastSeq: 7,
    });
    expect(parseClientFrame('ping')).toBeNull();
    expect(parseClientFrame('{"type":"resume","lastSeq":-1}')).toBeNull();
    expect(parseClientFrame('{"type":"resume","lastSeq":"1"}')).toBeNull();
    expect(parseClientFrame('{"type":"other"}')).toBeNull();
  });
});

describe('planResume', () => {
  it('replays a buffered gap', () => {
    expect(planResume(5, 1, 10)).toEqual({kind: 'replay', after: 5});
    expect(planResume(0, 1, 200)).toEqual({kind: 'replay', after: 0});
  });

  it('sends a snapshot when the gap is too large or pruned', () => {
    expect(planResume(0, 1, 201)).toEqual({kind: 'snapshot'});
    expect(planResume(10, 50, 100)).toEqual({kind: 'snapshot'});
    expect(planResume(20, 1, 10)).toEqual({kind: 'snapshot'});
  });

  it('does nothing when up to date', () => {
    expect(planResume(10, 1, 10)).toEqual({kind: 'none'});
    expect(planResume(0, 0, 0)).toEqual({kind: 'none'});
  });
});

describe('socketsToEvict', () => {
  const s = (n: number) => ({meta: {sub: 'u', actingAs: false, n}});
  it('closes the oldest beyond the cap of 3', () => {
    expect(socketsToEvict([s(4), s(2), s(9), s(1)]).map(x => x.meta.n)).toEqual(
      [1],
    );
    expect(socketsToEvict([s(1), s(2), s(3)])).toEqual([]);
    expect(
      socketsToEvict([s(5), s(1), s(2), s(3), s(4)]).map(x => x.meta.n),
    ).toEqual([1, 2]);
  });
});
