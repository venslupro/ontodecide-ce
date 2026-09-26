import {describe, expect, it} from 'vitest';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  filterProps,
  matchFilter,
} from './object_set';
import type {FilterExpr} from './object_set';

describe('matchFilter', () => {
  const props = {riskScore: 72, status: 'active', name: 'Hanoi Circuit Works'};

  it.each<[FilterExpr, boolean]>([
    [{op: 'gte', prop: 'riskScore', value: 70}, true],
    [{op: 'lt', prop: 'riskScore', value: 70}, false],
    [{op: 'eq', prop: 'status', value: 'active'}, true],
    [{op: 'neq', prop: 'status', value: 'active'}, false],
    [{op: 'in', prop: 'status', values: ['watch', 'active']}, true],
    [{op: 'contains', prop: 'name', value: 'circuit'}, true],
    [{op: 'exists', prop: 'country'}, false],
    [{op: 'gt', prop: 'missing', value: 1}, false],
    [{op: 'not', arg: {op: 'eq', prop: 'status', value: 'watch'}}, true],
    [
      {
        op: 'and',
        args: [
          {op: 'gte', prop: 'riskScore', value: 70},
          {
            op: 'or',
            args: [
              {op: 'eq', prop: 'status', value: 'x'},
              {op: 'exists', prop: 'name'},
            ],
          },
        ],
      },
      true,
    ],
  ])('%j → %s', (expr, expected) => {
    expect(matchFilter(expr, props)).toBe(expected);
  });

  it('treats an absent filter as match-all and collects props', () => {
    expect(matchFilter(undefined, {})).toBe(true);
    expect(
      filterProps({
        op: 'and',
        args: [
          {op: 'gt', prop: 'a', value: 1},
          {op: 'not', arg: {op: 'exists', prop: 'b'}},
        ],
      }),
    ).toEqual(['a', 'b']);
  });
});

describe('paging helpers', () => {
  it('clamps limits and round-trips cursors', () => {
    expect(clampLimit()).toBe(50);
    expect(clampLimit(0)).toBe(50);
    expect(clampLimit(500)).toBe(200);
    expect(clampLimit(-3)).toBe(1);
    expect(decodeCursor(encodeCursor({o: 50}))).toEqual({o: 50});
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});
