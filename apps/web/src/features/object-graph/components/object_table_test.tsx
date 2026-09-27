/**
 * @fileoverview Ontology-driven object table: columns from the ontology,
 * renderer cells, sortable indexed headers, keyboard open, and
 * virtualization above 100 rows.
 */

import type {ObjectDto} from '@ontodecide/object-graph/contract';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {toUiModel} from '../../../entities/schema/model';
import {makeObjects, ontologyDto, rid} from '../../../test/fixtures/business';
import {ObjectTable} from './object_table';

const type = toUiModel(ontologyDto, 'zh-CN').byName.Supplier;
const suppliers = makeObjects().filter(o => o.type === 'Supplier');

function many(n: number): ObjectDto[] {
  return Array.from({length: n}, (_, i) => ({
    ...suppliers[0],
    rid: rid('Supplier', 1000 + i),
    primaryKey: `S-${i}`,
    title: `Supplier #${i}`,
    props: {
      ...suppliers[0].props,
      supplierId: `S-${i}`,
      name: `Supplier #${i}`,
    },
  }));
}

describe('ObjectTable', () => {
  it('renders ontology columns and typed cells', () => {
    render(<ObjectTable type={type} rows={suppliers} onOpen={() => {}} />);
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(headers.slice(0, 3)).toEqual(['名称', '供应商编号', '国家']);
    expect(screen.getByText('苏州精密零件有限公司')).toBeInTheDocument();
    // enum rendered as a badge, integer with unit
    expect(screen.getAllByText('watch')[0]).toBeInTheDocument();
    expect(screen.getAllByText('4,000').length).toBeGreaterThan(0);
  });

  it('sorts only indexed properties and reflects aria-sort', async () => {
    const onSort = vi.fn();
    render(
      <ObjectTable
        type={type}
        rows={suppliers}
        orderBy={{prop: 'riskScore', dir: 'desc'}}
        onSort={onSort}
        onOpen={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', {name: '按 风险分 排序'}));
    expect(onSort).toHaveBeenCalledWith('riskScore');
    const risk = screen
      .getAllByRole('columnheader')
      .find(h => h.textContent?.includes('风险分'))!;
    expect(risk).toHaveAttribute('aria-sort', 'descending');
    // country is not indexed → no sort button
    expect(screen.queryByRole('button', {name: '按 国家 排序'})).toBeNull();
  });

  it('opens a row with click and Enter', async () => {
    const onOpen = vi.fn();
    render(<ObjectTable type={type} rows={suppliers} onOpen={onOpen} />);
    const row = screen.getByText('宁波恒达机电').closest('tr')!;
    await userEvent.click(row);
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen.mock.calls[0][0].primaryKey).toBe('S-022');
  });

  it('renders all rows up to 100 and virtualizes above', () => {
    // jsdom has no layout: give the scroll container a viewport.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(640);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200);
    const {container, unmount} = render(
      <ObjectTable type={type} rows={many(100)} onOpen={() => {}} />,
    );
    expect(container.querySelector('[data-virtualized]')).toBeNull();
    expect(
      within(container.querySelector('tbody')!).getAllByRole('row'),
    ).toHaveLength(100);
    unmount();
    const v = render(
      <ObjectTable type={type} rows={many(300)} onOpen={() => {}} />,
    );
    expect(v.container.querySelector('[data-virtualized]')).not.toBeNull();
    const rendered = v.container.querySelectorAll('tbody tr[tabindex]').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
    expect(v.container.querySelector('table')).toHaveAttribute(
      'aria-rowcount',
      '301',
    );
    vi.restoreAllMocks();
  });
});
