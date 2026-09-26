/**
 * @fileoverview Recommendation detail: approve confirmation lists write-backs,
 * optimistic "Approved" before the server answers, rollback + toast on error,
 * mandatory reject reason, actions hidden for Viewer / non-Proposed.
 */

import type {RecommendationDto} from '@ontodecide/decision/contract';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import * as fx from '../../test/fixtures';
import {db, problem} from '../../test/handlers';
import {renderApp} from '../../test/render';
import {server} from '../../test/server';

// jsdom has no canvas: make ECharts init fail so charts render only their aria label.
vi.mock('../../shared/charts/echarts', () => ({
  echarts: {
    init: () => {
      throw new Error('no canvas');
    },
  },
}));

const URL = '/recommendations/rec-1';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(r => {
    release = r;
  });
  return {wait, release};
}

async function statusRegion() {
  return screen.findByRole('status', {name: '建议状态'}, {timeout: 5000});
}

async function openApprove(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', {name: '批准并执行'}, {timeout: 5000}),
  );
  return screen.findByRole('dialog', {name: '确认批准并执行'});
}

describe('RecommendationPage', () => {
  it('renders summary, action table and evidence links', async () => {
    renderApp(URL, {user: fx.operatorUser});
    expect(
      await screen.findByRole(
        'heading',
        {name: fx.recommendation.summary},
        {timeout: 5000},
      ),
    ).toBeInTheDocument();
    expect(
      within(await statusRegion()).getByText('待审批'),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', {name: '推荐动作'});
    expect(within(table).getByText('切换供应商')).toBeInTheDocument();
    expect(within(table).getByText('+22%')).toBeInTheDocument();
    const evidence = screen.getByRole('list', {name: '证据链'});
    expect(within(evidence).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      `/objects/rid/${fx.rid('Supplier', 'S002')}#prop-riskScore`,
    );
  });

  it('lists only the rank-1 action (the one executed) with its write-back target', async () => {
    renderApp(URL, {user: fx.operatorUser});
    const user = userEvent.setup();
    const dialog = await openApprove(user);
    expect(within(dialog).getByText('切换供应商')).toBeInTheDocument();
    expect(within(dialog).queryByText('提高安全库存')).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('无外部回写')).toHaveLength(1);
  });

  it('shows Approved optimistically, then Executed when the server answers', async () => {
    const g = gate();
    server.use(
      http.post('*/api/v1/recommendations/:id/approve', async () => {
        await g.wait;
        const r = db.recommendations[0];
        r.status = 'Executed';
        r.actions = r.actions.map(a => ({
          ...a,
          execution: {status: 'Executed', actionLogId: 'al-x'},
        }));
        return HttpResponse.json(r as RecommendationDto);
      }),
    );
    renderApp(URL, {user: fx.operatorUser});
    const user = userEvent.setup();
    const dialog = await openApprove(user);
    await user.click(within(dialog).getByRole('button', {name: '确认执行'}));

    // Server has not answered yet: optimistic status.
    await waitFor(async () =>
      expect(
        within(await statusRegion()).getByText('已批准'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', {name: '批准并执行'}),
    ).not.toBeInTheDocument();

    g.release();
    await waitFor(async () =>
      expect(
        within(await statusRegion()).getByText('已执行'),
      ).toBeInTheDocument(),
    );
    expect(await screen.findByText('已批准，动作执行完成')).toBeInTheDocument();
  });

  it('rolls back to Proposed and shows an error toast when approval fails', async () => {
    const g = gate();
    server.use(
      http.post('*/api/v1/recommendations/:id/approve', async () => {
        await g.wait;
        return problem(409, 'INVALID_TRANSITION', 'not proposed');
      }),
    );
    renderApp(URL, {user: fx.operatorUser});
    const user = userEvent.setup();
    const dialog = await openApprove(user);
    await user.click(within(dialog).getByRole('button', {name: '确认执行'}));
    await waitFor(async () =>
      expect(
        within(await statusRegion()).getByText('已批准'),
      ).toBeInTheDocument(),
    );

    g.release();
    await waitFor(async () =>
      expect(
        within(await statusRegion()).getByText('待审批'),
      ).toBeInTheDocument(),
    );
    const alerts = await screen.findAllByRole('alert');
    expect(
      alerts.some(a => a.textContent?.includes('批准失败，已恢复原状态')),
    ).toBe(true);
    expect(
      alerts.some(a => a.textContent?.includes('当前状态不允许此操作')),
    ).toBe(true);
    expect(
      screen.getByRole('button', {name: '批准并执行'}),
    ).toBeInTheDocument();
  });

  it('rolls back on a server error too', async () => {
    server.use(
      http.post('*/api/v1/recommendations/:id/approve', () =>
        problem(500, 'INTERNAL'),
      ),
    );
    renderApp(URL, {user: fx.operatorUser});
    const user = userEvent.setup();
    const dialog = await openApprove(user);
    await user.click(within(dialog).getByRole('button', {name: '确认执行'}));
    const alerts = await screen.findAllByRole('alert');
    await waitFor(() =>
      expect(alerts.some(a => a.textContent?.includes('服务器内部错误'))).toBe(
        true,
      ),
    );
    expect(
      within(await statusRegion()).getByText('待审批'),
    ).toBeInTheDocument();
  });

  it('requires a reason to reject', async () => {
    renderApp(URL, {user: fx.operatorUser});
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {name: '驳回'}, {timeout: 5000}),
    );
    const dialog = await screen.findByRole('dialog', {name: '驳回建议'});
    await user.click(within(dialog).getByRole('button', {name: '确认驳回'}));
    expect(
      await within(dialog).findByText('请填写驳回原因'),
    ).toBeInTheDocument();
    expect(db.recommendations[0].status).toBe('Proposed');

    await user.type(
      within(dialog).getByLabelText(/驳回原因/),
      '替代供应商尚未认证',
    );
    await user.click(within(dialog).getByRole('button', {name: '确认驳回'}));
    await waitFor(async () =>
      expect(
        within(await statusRegion()).getByText('已驳回'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(db.recommendations[0].rejectReason).toBe('替代供应商尚未认证'),
    );
  });

  it('hides approval actions for non-Proposed recommendations and shows feedback', async () => {
    db.recommendations[0].status = 'Executed';
    renderApp(URL, {user: fx.operatorUser});
    expect(
      within(await statusRegion()).getByText('已执行'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: '批准并执行'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: '驳回'}),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('radio', {name: '5 星'})).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', {name: '4 星'}));
    await user.click(screen.getByRole('button', {name: '提交反馈'}));
    expect(
      await screen.findByText('感谢反馈，已用于改进后续建议。'),
    ).toBeInTheDocument();
    expect(db.recommendations[0].feedback?.rating).toBe(4);
  });

  it('hides approval actions for Viewer', async () => {
    renderApp(URL, {user: fx.viewerUser});
    await screen.findByText(/此页面需要/, undefined, {timeout: 5000});
    expect(
      screen.queryByRole('button', {name: '批准并执行'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: '驳回'}),
    ).not.toBeInTheDocument();
  });

  it('shows a generating state while the recommendation is a Draft', async () => {
    db.recommendations[0].status = 'Draft';
    renderApp(URL, {user: fx.operatorUser});
    expect(
      await screen.findByText('AI 正在分析证据并生成建议…', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
  });
});
