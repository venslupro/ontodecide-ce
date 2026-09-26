/**
 * @fileoverview Object table: schema-driven columns (order, localized
 * headers), markings lock, sortable only on indexed properties, renderer
 * cells and row activation.
 */

import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {toUiModel} from '../../../entities/schema/model';
import {compiledModel, suppliers} from '../../../test/fixtures';
import {renderWithProviders} from '../../../test/render';
import {resolveColumns} from '../model';
import {ObjectTable} from './object_table';

// A caller without the PII marking: `contactEmail` is hidden.
const supplier = toUiModel(compiledModel, 'zh-CN', []).byName.Supplier;

function renderTable(
  overrides: Partial<Parameters<typeof ObjectTable>[0]> = {},
) {
  const onSortChange = vi.fn();
  const onOpen = vi.fn();
  renderWithProviders(
    <ObjectTable
      type={supplier}
      rows={suppliers}
      columns={resolveColumns(supplier, undefined)}
      label="供应商列表"
      onSortChange={onSortChange}
      onOpen={onOpen}
      {...overrides}
    />,
  );
  return {onSortChange, onOpen};
}

describe('ObjectTable', () => {
  it('generates localized columns from the schema in schema order', async () => {
    renderTable();
    const table = await screen.findByRole('table', {name: '供应商列表'});
    const headers = within(table)
      .getAllByRole('columnheader')
      .map(h => h.textContent);
    expect(headers).toEqual([
      '名称',
      '供应商编号',
      '国家',
      '风险分',
      '产能(units/day)',
      '准时率',
      '状态',
      '联系邮箱',
    ]);
  });

  it('shows a lock on properties hidden by markings and hides their values', async () => {
    renderTable();
    await screen.findByRole('table');
    const header = screen
      .getAllByRole('columnheader')
      .find(h => h.textContent?.includes('联系邮箱'))!;
    expect(
      within(header).getByRole('img', {
        name: '无访问权限（需要对应 Markings）',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('ops@szpp.example')).not.toBeInTheDocument();
  });

  it('makes only indexed properties sortable', async () => {
    const {onSortChange} = renderTable({sort: {prop: 'capacity', dir: 'desc'}});
    await screen.findByRole('table');
    const header = (name: string) =>
      screen
        .getAllByRole('columnheader')
        .find(h => h.textContent?.startsWith(name))!;
    // Indexed: name, country, riskScore, capacity, status.
    expect(
      within(header('风险分')).getByRole('button', {name: '按风险分排序'}),
    ).toBeInTheDocument();
    expect(header('风险分')).toHaveAttribute('aria-sort', 'none');
    expect(header('产能')).toHaveAttribute('aria-sort', 'descending');
    // Not indexed: supplierId, onTimeRate; hidden: contactEmail.
    expect(
      within(header('准时率')).queryByRole('button'),
    ).not.toBeInTheDocument();
    expect(
      within(header('供应商编号')).queryByRole('button'),
    ).not.toBeInTheDocument();
    expect(
      within(header('联系邮箱')).queryByRole('button'),
    ).not.toBeInTheDocument();
    expect(header('准时率')).not.toHaveAttribute('aria-sort');

    await userEvent
      .setup()
      .click(screen.getByRole('button', {name: '按风险分排序'}));
    expect(onSortChange).toHaveBeenCalledWith({prop: 'riskScore', dir: 'asc'});
  });

  it('renders cells through the renderer registry', async () => {
    renderTable();
    await screen.findByRole('table');
    const row = screen
      .getAllByRole('row')
      .find(r => r.getAttribute('data-rid') === suppliers[0].rid)!;
    const cells = within(row).getAllByRole('cell');
    // Title column links to the Object View.
    expect(
      within(cells[0]).getByRole('link', {name: 'Shenzhen Precision Parts'}),
    ).toHaveAttribute(
      'href',
      `/objects/rid/${encodeURIComponent(suppliers[0].rid)}`,
    );
    // Enum → badge; number with unit.
    expect(within(cells[6]).getByText('active')).toHaveClass('rounded-full');
    expect(cells[4]).toHaveTextContent('1,200units/day');
    expect(within(cells[4]).getByText('units/day')).toBeInTheDocument();
  });

  it('opens a row with Enter', async () => {
    const {onOpen} = renderTable();
    await screen.findByRole('table');
    const row = screen
      .getAllByRole('row')
      .find(r => r.getAttribute('data-rid') === suppliers[1].rid)!;
    row.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(suppliers[1]);
  });
});
