/**
 * @fileoverview Tests of FilterExpr → og_prop_index SQL translation,
 * executed against the real migrations to check SQL and semantics agree.
 */

import {describe, expect, it} from 'vitest';
import {matchFilter} from '@ontodecide/shared-kernel';
import type {FilterExpr} from '@ontodecide/shared-kernel';
import {SqliteD1} from '@ontodecide/testing';
import {join} from 'node:path';
import {REPO_ROOT} from '@ontodecide/testing';
import {SqlArgs, filterToSql, likePattern} from './sql_filter';

const ROWS: Record<string, Record<string, string | number>> = {
  r1: {country: 'CN', score: 0.9, tier: 1, name: 'Acme_Metals'},
  r2: {country: 'DE', score: 0.1, tier: 2, name: 'Beta'},
  r3: {score: 0.5, tier: 3, name: '100%Co'},
};

function db(): SqliteD1 {
  const d = new SqliteD1().migrate(
    join(REPO_ROOT, 'migrations', 'object-graph'),
  );
  for (const [rid, props] of Object.entries(ROWS)) {
    for (const [prop, value] of Object.entries(props)) {
      d.raw
        .prepare(
          `INSERT INTO og_prop_index (tenant_id, rid, prop, object_type, value)
           VALUES ('t', ?, ?, 'S', ?)`,
        )
        .run(rid, prop, value);
    }
  }
  return d;
}

function sqlMatches(d: SqliteD1, f: FilterExpr): string[] {
  const args = new SqlArgs();
  const where = filterToSql(f, 'o', args);
  const rows = d.raw
    .prepare(
      `SELECT o.rid FROM (SELECT DISTINCT rid FROM og_prop_index) o
       WHERE ${where} ORDER BY o.rid`,
    )
    .all('t', ...(args.values() as (string | number)[])) as {rid: string}[];
  return rows.map(r => r.rid);
}

function memMatches(f: FilterExpr): string[] {
  return Object.entries(ROWS)
    .filter(([, p]) => matchFilter(f, p))
    .map(([rid]) => rid)
    .sort();
}

describe('filterToSql', () => {
  const d = db();
  const cases: FilterExpr[] = [
    {op: 'eq', prop: 'country', value: 'CN'},
    {op: 'neq', prop: 'country', value: 'CN'},
    {op: 'gt', prop: 'score', value: 0.3},
    {op: 'lte', prop: 'tier', value: 2},
    {op: 'in', prop: 'tier', values: [1, 3]},
    {op: 'contains', prop: 'name', value: 'metal'},
    {op: 'contains', prop: 'name', value: '%'},
    {op: 'contains', prop: 'name', value: '_'},
    {op: 'exists', prop: 'country'},
    {op: 'not', arg: {op: 'exists', prop: 'country'}},
    {
      op: 'or',
      args: [
        {op: 'eq', prop: 'tier', value: 3},
        {
          op: 'and',
          args: [
            {op: 'gte', prop: 'score', value: 0.9},
            {op: 'eq', prop: 'country', value: 'CN'},
          ],
        },
      ],
    },
  ];
  for (const f of cases) {
    it(`agrees with matchFilter for ${JSON.stringify(f)}`, () => {
      expect(sqlMatches(d, f)).toEqual(memMatches(f));
    });
  }

  it('numbers placeholders from ?2', () => {
    const args = new SqlArgs();
    const sql = filterToSql({op: 'eq', prop: 'a', value: true}, 'o', args);
    expect(sql).toContain('?2');
    expect(sql).toContain('?3');
    expect(args.values()).toEqual(['a', 1]);
    expect(likePattern('a%b_c\\')).toBe('%a\\%b\\_c\\\\%');
  });
});
