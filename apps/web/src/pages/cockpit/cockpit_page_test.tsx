/**
 * @fileoverview Cockpit page: KPIs, alert stream (operator ack), pending
 * recommendations, data health, layout fallback and wall mode.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import {db, problem} from '../../test/handlers';
import {operatorUser, viewerUser} from '../../test/fixtures';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {CockpitPage} from './cockpit_page';

// jsdom has no canvas: replace the ECharts wrapper by its accessible label.
vi.mock('../../shared/charts/chart', async importOriginal => ({
  ...(await importOriginal<typeof import('../../shared/charts/chart')>()),
  EChart: ({ariaLabel}: {ariaLabel: string}) => (
    <div role="img" aria-label={ariaLabel} />
  ),
}));

const ACK_S002 = '确认告警：Hanoi Circuit Works riskScore 78';

describe('CockpitPage', () => {
  it('renders the KPI cards from the overview', async () => {
    renderWithProviders(<CockpitPage />, {url: '/cockpit'});
    for (const name of [
      '高风险供应商',
      '平均供应商风险',
      '缺货风险产品',
      '日需求总量',
    ]) {
      expect(await screen.findByRole('article', {name})).toBeInTheDocument();
    }
    const avg = screen.getByRole('article', {name: '平均供应商风险'});
    expect(within(avg).getByText('11.2% 较昨日')).toBeInTheDocument();
    expect(within(avg).getByText('目标 40')).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: '态势总览'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '大屏模式'})).toHaveAttribute(
      'href',
      '/cockpit?mode=wall',
    );
  });

  it('lists alerts by severity and lets an operator acknowledge one', async () => {
    renderWithProviders(<CockpitPage />, {url: '/cockpit', user: operatorUser});
    const user = userEvent.setup();
    const ack = await screen.findByRole('button', {name: ACK_S002});
    const items = screen.getAllByTestId('alert-item');
    // Open filter: HIGH before MEDIUM; the ACKED alert is hidden.
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Hanoi Circuit Works');
    expect(items[1]).toHaveTextContent('Handheld Scanner S2');
    expect(
      within(items[0]).getByRole('link', {name: /Hanoi Circuit Works/}),
    ).toHaveAttribute('href', '/objects/rid/ri.t1.Supplier.S002');
    await user.click(ack);
    await waitFor(() =>
      expect(db.alerts.find(a => a.id === 'al-risk-s002')?.status).toBe(
        'ACKED',
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', {name: ACK_S002})).toBeNull(),
    );
    await user.click(screen.getByRole('tab', {name: '全部'}));
    const all = screen.getAllByTestId('alert-item');
    expect(all).toHaveLength(3);
    const hanoi = all.find(i =>
      i.textContent?.includes('Hanoi Circuit Works'),
    )!;
    expect(within(hanoi).getByTestId('alert-status')).toHaveTextContent(
      '已确认',
    );
  });

  it('hides the acknowledge button from viewers', async () => {
    renderWithProviders(<CockpitPage />, {url: '/cockpit', user: viewerUser});
    expect(await screen.findAllByTestId('alert-item')).toHaveLength(2);
    expect(screen.queryByRole('button', {name: ACK_S002})).toBeNull();
  });

  it('links the pending recommendation and shows data health', async () => {
    renderWithProviders(<CockpitPage />, {url: '/cockpit'});
    const view = await screen.findByRole('link', {name: /^查看建议：/});
    expect(view).toHaveAttribute('href', '/recommendations/rec-1');
    const rec = screen.getByTestId('rec-item');
    expect(within(rec).getByText('AI 建议')).toBeInTheDocument();
    expect(within(rec).getByText('置信度 82%')).toBeInTheDocument();
    expect(within(rec).getByText('预期收益 +22%')).toBeInTheDocument();

    const health = screen.getAllByTestId('health-item');
    const products = health.find(h => h.textContent?.includes('products.csv'))!;
    expect(within(products).getByText('已过期')).toBeInTheDocument();
    const suppliers = health.find(h =>
      h.textContent?.includes('suppliers.csv'),
    )!;
    expect(within(suppliers).queryByText('已过期')).toBeNull();

    // Impacted objects come from the newest proposed recommendation's simulation.
    const impacted = await screen.findByRole('link', {name: 'Edge Gateway X1'});
    expect(impacted).toHaveAttribute('href', '/objects/rid/ri.t1.Product.P900');
  });

  it('falls back to the built-in layout when the layout request fails', async () => {
    server.use(
      http.get('*/api/v1/cockpit/layout', () => problem(404, 'NOT_FOUND')),
    );
    renderWithProviders(<CockpitPage />, {url: '/cockpit'});
    expect(
      await screen.findByRole('article', {name: '日需求总量'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: '实时告警'})).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: '数据健康度'}),
    ).toBeInTheDocument();
  });

  it('shows an error view with retry when the overview fails', async () => {
    server.use(
      http.get('*/api/v1/situation/overview', () => problem(500, 'INTERNAL')),
    );
    renderWithProviders(<CockpitPage />, {url: '/cockpit'});
    expect(await screen.findByText('态势数据加载失败')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '重试'})).toBeInTheDocument();
  });

  it('wall mode hides actions and exits on Esc', async () => {
    const {router} = renderWithProviders(<CockpitPage />, {
      url: '/cockpit?mode=wall',
      user: operatorUser,
    });
    expect(await screen.findByTestId('wall-header')).toBeInTheDocument();
    expect(
      await screen.findByRole('article', {name: '高风险供应商'}),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('alert-item')).toHaveLength(2);
    expect(screen.queryByRole('button', {name: ACK_S002})).toBeNull();
    expect(screen.queryByRole('button', {name: /确认/})).toBeNull();
    expect(screen.queryByRole('link', {name: '大屏模式'})).toBeNull();
    expect(screen.queryByRole('link', {name: /^查看建议：/})).toBeNull();
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(
      await screen.findByRole('link', {name: '大屏模式'}),
    ).toBeInTheDocument();
  });
});
