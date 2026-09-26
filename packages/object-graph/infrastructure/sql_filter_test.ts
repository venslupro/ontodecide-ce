import {describe, expect, it} from 'vitest';
import {filterToSql, likeEscape, orderToSql} from './sql_filter';

describe('sql_filter', () => {
  it('translates leaves to og_prop_index lookups', () => {
    const f = filterToSql({
      op: 'and',
      args: [
        {op: 'gte', prop: 'riskScore', value: 70},
        {op: 'eq', prop: 'status', value: 'active'},
        {op: 'eq', prop: 'flag', value: true},
      ],
    });
    expect(f.sql).toContain('i.num_val >= ?');
    expect(f.sql).toContain('i.str_val = ?');
    expect(f.params).toEqual(['riskScore', 70, 'status', 'active', 'flag', 1]);
    const n = filterToSql({
      op: 'not',
      arg: {op: 'in', prop: 'c', values: ['a', 1]},
    });
    expect(n.sql.startsWith('NOT (')).toBe(true);
    expect(n.params).toEqual(['c', '[1]', '["a"]']);
    expect(filterToSql({op: 'or', args: []}).sql).toBe('1 = 0');
  });

  it('escapes LIKE wildcards and orders nulls last', () => {
    expect(likeEscape('50%_a\\')).toBe('50\\%\\_a\\\\');
    const o = orderToSql([
      {prop: 'riskScore', dir: 'desc'},
      {prop: 'updatedAt', dir: 'asc'},
    ]);
    expect(o.joins.params).toEqual(['riskScore']);
    expect(o.orderBy).toContain('s0.num_val DESC');
    expect(o.orderBy.endsWith('o.rid ASC')).toBe(true);
  });
});
