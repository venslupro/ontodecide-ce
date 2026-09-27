/**
 * @fileoverview Tests of latest-wins merging and RFC 7396 merge patch.
 */

import {describe, expect, it} from 'vitest';
import {
  applyMergePatch,
  isEmptyValue,
  mergeLatestWins,
  patchProps,
  sameValue,
} from './conflict_resolution';

const P1 = {jobId: 'j1', row: 1, at: 1};
const P2 = {jobId: 'j2', row: 5, at: 2};

describe('mergeLatestWins', () => {
  it('creates state from nothing', () => {
    const r = mergeLatestWins(null, {a: 1, b: 'x'}, P1);
    expect(r.state.props).toEqual({a: 1, b: 'x'});
    expect(r.state.provenance).toEqual({a: P1, b: P1});
    expect(r.changed).toEqual(['a', 'b']);
  });

  it('overwrites with later non-empty values only', () => {
    const cur = {
      props: {a: 1, b: 'x', c: true},
      provenance: {a: P1, b: P1, c: P1},
    };
    const r = mergeLatestWins(cur, {a: 2, b: '', c: null, d: 0}, P2);
    expect(r.state.props).toEqual({a: 2, b: 'x', c: true, d: 0});
    expect(r.state.provenance).toEqual({a: P2, b: P1, c: P1, d: P2});
    expect(r.changed).toEqual(['a', 'd']);
  });

  it('treats deep-equal values as unchanged', () => {
    const cur = {props: {g: {lat: 1, lon: 2}}, provenance: {g: P1}};
    const r = mergeLatestWins(cur, {g: {lon: 2, lat: 1}}, P2);
    expect(r.changed).toEqual([]);
    expect(r.state.provenance.g).toBe(P1);
  });

  it('knows empty values', () => {
    expect([null, undefined, ''].every(isEmptyValue)).toBe(true);
    expect([0, false, 'a'].some(isEmptyValue)).toBe(false);
    expect(sameValue({a: 1, b: 2}, {b: 2, a: 1})).toBe(true);
  });
});

describe('merge patch', () => {
  it('follows RFC 7396', () => {
    expect(
      applyMergePatch({a: 'b', c: {d: 'e', f: 'g'}}, {a: 'z', c: {f: null}}),
    ).toEqual({a: 'z', c: {d: 'e'}});
    expect(applyMergePatch({a: [1, 2]}, {a: [3]})).toEqual({a: [3]});
    expect(applyMergePatch({a: 1}, 'x')).toBe('x');
    expect(applyMergePatch('x', {a: 1})).toEqual({a: 1});
  });

  it('reports changed props and drops their provenance', () => {
    const cur = {props: {a: 1, b: 2, c: 3}, provenance: {a: P1, b: P1, c: P1}};
    const r = patchProps(cur, {a: 1, b: null, c: 4, d: 'new'});
    expect(r.state.props).toEqual({a: 1, c: 4, d: 'new'});
    expect(r.changed).toEqual(['b', 'c', 'd']);
    expect(r.state.provenance).toEqual({a: P1});
  });
});
