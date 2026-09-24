/**
 * @fileoverview Condition builder: keyboard operation and FilterExpr output.
 */

import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {describe, expect, it} from 'vitest';
import type {RenderProp} from '../renderers/registry';
import {FilterBuilder} from './filter_builder';
import {
  type FilterGroup,
  fromFilterExpr,
  newGroup,
  toFilterExpr,
} from './filter_model';

const props: RenderProp[] = [
  {apiName: 'riskScore', displayName: '风险分', dataType: 'double'},
  {
    apiName: 'status',
    displayName: '状态',
    dataType: 'enum',
    enumValues: ['active', 'watch', 'suspended'],
  },
  {apiName: 'name', displayName: '名称', dataType: 'string'},
];
const byName = Object.fromEntries(props.map(p => [p.apiName, p]));

function Harness({onExpr}: {onExpr(e: unknown): void}) {
  const [g, setG] = useState<FilterGroup>(newGroup('and'));
  return (
    <FilterBuilder
      label="条件"
      value={g}
      properties={props}
      onChange={next => {
        setG(next);
        onExpr(toFilterExpr(next, byName));
      }}
    />
  );
}

describe('FilterBuilder', () => {
  it('builds an AND condition entirely with the keyboard', async () => {
    let expr: unknown;
    render(<Harness onExpr={e => (expr = e)} />);
    const user = userEvent.setup();
    await user.tab();
    // AND / OR radios come first, then "add condition".
    expect(screen.getByRole('radio', {name: '全部 (AND)'})).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', {name: '添加条件'})).toHaveFocus();
    await user.keyboard('{Enter}');
    const row = screen.getByRole('group', {name: '条件 1'});
    const prop = within(row).getByRole('combobox', {name: '属性'});
    // Focus moves to the new row.
    expect(prop).toHaveFocus();
    expect(prop).toHaveValue('riskScore');
    await user.tab();
    const op = within(row).getByRole('combobox', {name: '算子'});
    expect(op).toHaveFocus();
    await user.selectOptions(op, 'gte');
    await user.tab();
    await user.keyboard('70');
    expect(expr).toEqual({op: 'gte', prop: 'riskScore', value: 70});
  });

  it('combines multiple rows with OR and supports enum and in values', async () => {
    let expr: unknown;
    render(<Harness onExpr={e => (expr = e)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', {name: '添加条件'}));
    await user.click(screen.getByRole('button', {name: '添加条件'}));
    const rows = screen.getAllByRole('group', {name: /条件 \d/});
    await user.selectOptions(
      within(rows[0]).getByRole('combobox', {name: '属性'}),
      'status',
    );
    await user.selectOptions(
      within(rows[0]).getByRole('combobox', {name: '值'}),
      'watch',
    );
    await user.selectOptions(
      within(rows[1]).getByRole('combobox', {name: '属性'}),
      'name',
    );
    await user.selectOptions(
      within(rows[1]).getByRole('combobox', {name: '算子'}),
      'in',
    );
    await user.type(within(rows[1]).getByRole('textbox', {name: '值'}), 'A, B');
    await user.click(screen.getByRole('radio', {name: '任一 (OR)'}));
    expect(expr).toEqual({
      op: 'or',
      args: [
        {op: 'eq', prop: 'status', value: 'watch'},
        {op: 'in', prop: 'name', values: ['A', 'B']},
      ],
    });
  });

  it('removes rows and nests groups', async () => {
    let expr: unknown;
    render(<Harness onExpr={e => (expr = e)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', {name: '添加条件'}));
    await user.type(screen.getByRole('spinbutton', {name: '值'}), '10');
    await user.click(screen.getByRole('button', {name: '添加条件组'}));
    const group = screen.getByRole('group', {name: '条件组'});
    await user.click(within(group).getByRole('button', {name: '添加条件'}));
    await user.type(within(group).getByRole('spinbutton', {name: '值'}), '90');
    expect(expr).toEqual({
      op: 'and',
      args: [
        {op: 'eq', prop: 'riskScore', value: 10},
        {op: 'eq', prop: 'riskScore', value: 90},
      ],
    });
    await user.click(screen.getAllByRole('button', {name: '删除条件 1'})[0]);
    expect(expr).toEqual({op: 'eq', prop: 'riskScore', value: 90});
  });

  it('round-trips FilterExpr', () => {
    const e = {
      op: 'and' as const,
      args: [
        {op: 'gte' as const, prop: 'riskScore', value: 70},
        {op: 'exists' as const, prop: 'name'},
      ],
    };
    expect(toFilterExpr(fromFilterExpr(e), byName)).toEqual(e);
    expect(toFilterExpr(fromFilterExpr(undefined), byName)).toBeUndefined();
  });
});
