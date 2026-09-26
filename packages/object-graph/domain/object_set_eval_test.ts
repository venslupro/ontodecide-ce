import {describe, expect, it} from 'vitest';
import {
  aggregateValues,
  filterObjects,
  sortObjects,
  splitFilter,
} from './object_set_eval';

describe('object set helpers', () => {
  const indexed = new Set(['riskScore', 'status']);

  it('pushes indexed conjuncts down and keeps the residual', () => {
    expect(
      splitFilter({op: 'gte', prop: 'riskScore', value: 70}, indexed),
    ).toEqual({
      indexed: {op: 'gte', prop: 'riskScore', value: 70},
    });
    const split = splitFilter(
      {
        op: 'and',
        args: [
          {op: 'eq', prop: 'status', value: 'active'},
          {
            op: 'and',
            args: [
              {op: 'gt', prop: 'onTimeRate', value: 0.8},
              {op: 'lt', prop: 'riskScore', value: 50},
            ],
          },
        ],
      },
      indexed,
    );
    expect(split.indexed).toEqual({
      op: 'and',
      args: [
        {op: 'eq', prop: 'status', value: 'active'},
        {op: 'lt', prop: 'riskScore', value: 50},
      ],
    });
    expect(split.residual).toEqual({op: 'gt', prop: 'onTimeRate', value: 0.8});
    const or = {
      op: 'or' as const,
      args: [
        {op: 'exists' as const, prop: 'x'},
        {op: 'exists' as const, prop: 'status'},
      ],
    };
    expect(splitFilter(or, indexed)).toEqual({residual: or});
    expect(splitFilter(undefined, indexed)).toEqual({});
  });

  it('sorts with nulls last and RID tie-break', () => {
    const items = [
      {rid: 'b', props: {v: 2}},
      {rid: 'a', props: {v: 2}},
      {rid: 'c', props: {}},
      {rid: 'd', props: {v: 5}},
    ];
    expect(
      sortObjects(items, [{prop: 'v', dir: 'desc'}]).map(i => i.rid),
    ).toEqual(['d', 'a', 'b', 'c']);
    expect(
      sortObjects(items, [{prop: 'v', dir: 'asc'}]).map(i => i.rid),
    ).toEqual(['a', 'b', 'd', 'c']);
    expect(
      filterObjects(items, {op: 'gt', prop: 'v', value: 2}).map(i => i.rid),
    ).toEqual(['d']);
  });

  it('aggregates', () => {
    const v = [1, 2, 'x', null, 6];
    expect(aggregateValues('count', v)).toBe(5);
    expect(aggregateValues('sum', v)).toBe(9);
    expect(aggregateValues('avg', v)).toBe(3);
    expect(aggregateValues('min', v)).toBe(1);
    expect(aggregateValues('max', v)).toBe(6);
    expect(aggregateValues('avg', [])).toBe(0);
  });
});
