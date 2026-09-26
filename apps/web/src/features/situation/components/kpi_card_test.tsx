/**
 * @fileoverview KpiCard: value + unit, ▲▼ change with text and good/bad
 * semantics, target, off-target marker and null values.
 */

import type {KpiValue} from '@ontodecide/situation/contract';
import {screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {renderWithProviders} from '../../../test/render';
import {KpiCard} from './kpi_card';

const base: KpiValue = {
  id: 'k',
  name: {'zh-CN': '日需求总量', 'en-US': 'Total daily demand'},
  value: 950,
  previous: 910,
  target: null,
  unit: 'units',
  higherIsBetter: true,
  spark: [1, 2, 3, 2, 4],
  updatedAt: '2026-09-24T08:00:00.000Z',
};

async function renderCard(kpi: KpiValue) {
  renderWithProviders(<KpiCard kpi={kpi} />);
  return screen.findByRole('article', {
    name: typeof kpi.name === 'string' ? kpi.name : kpi.name['zh-CN'],
  });
}

describe('KpiCard', () => {
  it('renders the value with its unit', async () => {
    const card = await renderCard(base);
    expect(within(card).getByTestId('kpi-value')).toHaveTextContent('950');
    expect(within(card).getByText('units')).toBeInTheDocument();
  });

  it('shows ▲ with text in the good color when a higher-is-better KPI rises', async () => {
    const card = await renderCard(base);
    const delta = within(card).getByTestId('kpi-delta');
    expect(delta).toHaveTextContent('▲');
    expect(delta).toHaveTextContent('4.4% 较昨日');
    expect(delta).toHaveTextContent('上升');
    expect(delta).toHaveTextContent('向好');
    expect(delta).toHaveAttribute('data-trend', 'good');
    expect(delta).toHaveClass('text-good');
  });

  it('treats a rise as bad when lower is better', async () => {
    const card = await renderCard({
      ...base,
      name: '平均供应商风险',
      value: 45.8,
      previous: 41.2,
      target: 40,
      unit: null,
      higherIsBetter: false,
    });
    const delta = within(card).getByTestId('kpi-delta');
    expect(delta).toHaveTextContent('▲');
    expect(delta).toHaveTextContent('11.2% 较昨日');
    expect(delta).toHaveTextContent('变差');
    expect(delta).toHaveAttribute('data-trend', 'bad');
    expect(delta).toHaveClass('text-crit');
    expect(within(card).getByText('目标 40')).toBeInTheDocument();
    // Off target: status color plus an icon + label (not color only).
    expect(within(card).getByTestId('kpi-off-target')).toHaveTextContent(
      '未达标',
    );
    expect(within(card).getByTestId('kpi-value')).toHaveClass('text-crit');
  });

  it('shows ▼ as good when a lower-is-better KPI falls and hides the marker on target', async () => {
    const card = await renderCard({
      ...base,
      name: '缺货风险产品',
      value: 1,
      previous: 2,
      target: 1,
      unit: null,
      higherIsBetter: false,
    });
    const delta = within(card).getByTestId('kpi-delta');
    expect(delta).toHaveTextContent('▼');
    expect(delta).toHaveTextContent('50.0% 较昨日');
    expect(delta).toHaveAttribute('data-trend', 'good');
    expect(within(card).queryByTestId('kpi-off-target')).toBeNull();
    expect(within(card).getByText('目标 1')).toBeInTheDocument();
  });

  it('shows — for null values and omits the change', async () => {
    const card = await renderCard({
      ...base,
      name: '空指标',
      value: null,
      previous: null,
    });
    expect(within(card).getByTestId('kpi-value')).toHaveTextContent('—');
    expect(within(card).getByTestId('kpi-delta')).toHaveTextContent('—');
    expect(within(card).queryByText('units')).toBeNull();
    expect(within(card).queryByText(/较昨日/)).toBeNull();
  });
});
