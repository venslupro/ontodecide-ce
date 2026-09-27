/**
 * @fileoverview KPI card: value with unit, ▲▼ change with text (not only
 * colour), target, and the off-target icon.
 */

import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {makeKpis} from '../../../test/fixtures/business';
import {KpiCard} from './kpi_card';

const [otd, shortage, flat] = makeKpis();

describe('KpiCard', () => {
  it('shows value, a falling delta in points and the target', () => {
    render(<KpiCard kpi={otd} />);
    const card = screen.getByRole('article', {name: '准时交付率'});
    expect(card).toHaveTextContent('91.4');
    expect(card).toHaveTextContent('%');
    expect(screen.getByText('下降')).toBeInTheDocument();
    expect(card).toHaveTextContent('2.1 pt');
    expect(card).toHaveTextContent('目标 95%');
    expect(screen.getByLabelText('未达目标')).toBeInTheDocument();
  });

  it('shows a rising delta vs yesterday', () => {
    render(<KpiCard kpi={shortage} />);
    const card = screen.getByRole('article', {name: '缺料风险订单'});
    expect(screen.getByText('上升')).toBeInTheDocument();
    expect(card).toHaveTextContent('12');
    expect(card).toHaveTextContent('较昨日');
    expect(screen.queryByLabelText('未达目标')).toBeNull();
  });

  it('marks unchanged values', () => {
    render(
      <KpiCard
        kpi={flat}
        points={[
          {ts: 'a', value: 1},
          {ts: 'b', value: 2},
        ]}
      />,
    );
    expect(screen.getByText('持平')).toBeInTheDocument();
  });
});
