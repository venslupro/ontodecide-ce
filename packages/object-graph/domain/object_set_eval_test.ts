/**
 * @fileoverview Tests of query planning (push-down vs in-memory).
 */

import {describe, expect, it} from 'vitest';
import {AppError} from '@ontodecide/shared-kernel';
import type {FilterExpr} from '@ontodecide/shared-kernel';
import {matchesText, planSort, splitFilter} from './object_set_eval';

const indexed = new Set(['a', 'b']);
const eqA: FilterExpr = {op: 'eq', prop: 'a', value: 1};
const eqB: FilterExpr = {op: 'gt', prop: 'b', value: 2};
const eqC: FilterExpr = {op: 'contains', prop: 'c', value: 'x'};

describe('splitFilter', () => {
  it('pushes fully indexed filters down whole', () => {
    const f: FilterExpr = {op: 'or', args: [eqA, {op: 'not', arg: eqB}]};
    expect(splitFilter(f, indexed)).toEqual({pushdown: f});
  });

  it('splits a top-level and', () => {
    expect(splitFilter({op: 'and', args: [eqA, eqC, eqB]}, indexed)).toEqual({
      pushdown: {op: 'and', args: [eqA, eqB]},
      residual: eqC,
    });
    expect(splitFilter({op: 'and', args: [eqA, eqC]}, indexed)).toEqual({
      pushdown: eqA,
      residual: eqC,
    });
  });

  it('keeps mixed disjunctions in memory', () => {
    const f: FilterExpr = {op: 'or', args: [eqA, eqC]};
    expect(splitFilter(f, indexed)).toEqual({residual: f});
    expect(splitFilter(undefined, indexed)).toEqual({});
  });
});

describe('planSort', () => {
  it('allows built-in and indexed keys only', () => {
    expect(planSort(undefined, indexed)).toEqual({kind: 'default'});
    expect(planSort({prop: 'title', dir: 'desc'}, indexed)).toEqual({
      kind: 'column',
      key: 'title',
      dir: 'desc',
    });
    expect(planSort({prop: 'a', dir: 'asc'}, indexed)).toEqual({
      kind: 'indexed',
      prop: 'a',
      dir: 'asc',
    });
    expect(() => planSort({prop: 'c', dir: 'asc'}, indexed)).toThrow(AppError);
  });
});

describe('matchesText', () => {
  it('matches title, primary key and exact rid', () => {
    const o = {rid: 'ri.S.01ABC', title: 'Acme Metals', primaryKey: 'S-001'};
    expect(matchesText('metal', o)).toBe(true);
    expect(matchesText('s-00', o)).toBe(true);
    expect(matchesText('ri.s.01abc', o)).toBe(true);
    expect(matchesText('ri.S.01', o)).toBe(false);
  });
});
