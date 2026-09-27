/**
 * @fileoverview Recommendation center: filter tabs, detail (ranked-by badge
 * with model, ranked candidates with fixed parameters, evidence lineage),
 * confirm with an Idempotency-Key reused across retries (and replayed
 * without executing twice), reject with a required reason, optimistic
 * update rolled back on 409 / 500.
 */

import {act, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {delay, http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import {useSession} from '../../entities/session/store';
import {PO5530, S017, S022} from '../../test/fixtures';
import {businessDb} from '../../test/handlers/business';
import {API, problem} from '../../test/handlers/problem';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {RecommendationsPage} from './recommendations_page';

// The page is rendered on its own; the app route tree is not needed.
vi.mock('../../app/router', () => ({routeTree: undefined}));

function render(url: string) {
  const r = renderWithProviders(<RecommendationsPage />, {url});
  act(() =>
    useSession.getState().setGrant({accessToken: 'token-0', expiresIn: 900}),
  );
  return r;
}

const decisionRequests = () =>
  businessDb.requests.filter(
    r => r.method === 'POST' && r.path.endsWith('/decision'),
  );

async function detail() {
  return screen.findByTestId('rec-detail');
}

describe('RecommendationsPage', () => {
  it('filters by 待确认 / 已执行 / 全部 and navigates on selection', async () => {
    const user = userEvent.setup();
    const {router} = render('/recommendations');
    expect(
      await screen.findByRole('heading', {name: '待确认建议'}),
    ).toBeInTheDocument();
    let items = await screen.findAllByTestId('rec-item');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('待确认')).toBeInTheDocument();
    expect(screen.getByText('选择左侧的建议查看详情')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', {name: '已执行'}));
    await waitFor(() =>
      expect(screen.getAllByTestId('rec-item')).toHaveLength(1),
    );
    items = screen.getAllByTestId('rec-item');
    expect(
      within(items[0]).getByText('提高 M-2231 安全库存 20%'),
    ).toBeInTheDocument();
    expect(within(items[0]).getByText('已执行')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', {name: '全部'}));
    await waitFor(() =>
      expect(screen.getAllByTestId('rec-item')).toHaveLength(3),
    );

    await user.click(screen.getAllByTestId('rec-item')[0]);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/recommendations/rec-203'),
    );
    expect(await detail()).toBeInTheDocument();
  });

  it('shows the detail: AI ranked with model, fixed parameters, evidence lineage', async () => {
    render('/recommendations/rec-203');
    const d = await detail();
    expect(within(d).getByText('REC-203')).toBeInTheDocument();
    expect(
      within(d).getByRole('heading', {name: 'PO-5530 切换至备选供应商 S-022'}),
    ).toBeInTheDocument();
    expect(within(d).getByText('AI 排序（qwen3-30b-a3b）')).toBeInTheDocument();
    expect(within(d).getByText('0.78')).toBeInTheDocument();

    const table = within(d).getByRole('table', {name: '候选动作（按排序）'});
    const rows = within(table).getAllByTestId('candidate-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('切换供应商')).toBeInTheDocument();
    expect(within(rows[0]).getByText('将执行')).toBeInTheDocument();
    expect(
      within(rows[0]).getByRole('link', {name: 'PO-5530'}),
    ).toHaveAttribute('href', `/objects/${PO5530}`);
    expect(await within(rows[0]).findByText('新供应商:')).toBeInTheDocument();
    expect(
      await within(rows[0]).findByRole('link', {name: '宁波恒达机电'}),
    ).toHaveAttribute('href', `/objects/${S022}`);
    expect(within(rows[0]).getByText('+12%')).toBeInTheDocument();
    expect(within(rows[1]).getByText('调整安全库存')).toBeInTheDocument();
    expect(within(rows[1]).getByText('400')).toBeInTheDocument();
    expect(
      within(d).getByText('参数由确定性推演器生成，不可修改'),
    ).toBeInTheDocument();
    // Parameters are read-only: no inputs in the candidates table.
    expect(within(table).queryByRole('textbox')).toBeNull();

    const evidence = within(d).getAllByTestId('evidence-item');
    expect(evidence).toHaveLength(2);
    const propLink = within(evidence[0]).getByRole('link', {
      name: /capacityPerWeek/,
    });
    expect(propLink.getAttribute('href')).toBe(
      `/objects/${S017}?prop=capacityPerWeek`,
    );
    expect(
      within(evidence[0]).getByText(/文件导入 imp-0412 第 3 行/),
    ).toBeInTheDocument();
    expect(within(evidence[1]).getByText('无导入来源')).toBeInTheDocument();
    expect(within(d).getByRole('link', {name: /情景 SCN-041/})).toHaveAttribute(
      'href',
      '/scenarios/scn-041',
    );
    expect(within(d).getByText('单价上升约 3%')).toBeInTheDocument();
    expect(
      await within(d).findByText(
        '确认后更新工作区内的 采购订单 并写入审计日志',
      ),
    ).toBeInTheDocument();
  });

  it('marks rule-ranked recommendations and explains why', async () => {
    render('/recommendations/rec-204');
    const d = await detail();
    expect(within(d).getByText('规则排序')).toBeInTheDocument();
    expect(
      within(d).getAllByText(/今日 AI 额度已用完或 AI 暂不可用/).length,
    ).toBeGreaterThan(0);
  });

  it('confirm sends an Idempotency-Key and a retry after a network failure reuses it', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    server.use(
      http.post(
        `${API}/recommendations/:id/decision`,
        ({request}) => {
          keys.push(request.headers.get('idempotency-key') ?? '');
          return HttpResponse.error();
        },
        {once: true},
      ),
    );
    render('/recommendations/rec-203');
    const d = await detail();
    await user.click(within(d).getByRole('button', {name: '确认并执行'}));
    const dialog = await screen.findByRole('dialog', {name: '确认并执行建议'});
    expect(dialog).toHaveTextContent(
      '将在工作区内对「PO-5530」执行「切换供应商」',
    );
    expect(dialog).toHaveTextContent('不会回写任何外部系统');

    await user.click(within(dialog).getByRole('button', {name: '确认并执行'}));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', {name: '重试'}));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    const sent = decisionRequests();
    expect(sent).toHaveLength(1);
    expect(keys).toHaveLength(1);
    expect(keys[0].length).toBeGreaterThanOrEqual(16);
    expect(sent[0].headers['idempotency-key']).toBe(keys[0]);
    expect(sent[0].body).toEqual({decision: 'confirm'});
    expect(await within(d).findByText('已执行')).toBeInTheDocument();
  });

  it('replays a lost response with the same key without executing twice', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(
        `${API}/recommendations/:id/decision`,
        ({request, params}) => {
          // The server executes, but the response is lost on the way back.
          const r = businessDb.recommendations.find(x => x.id === params.id)!;
          r.status = 'Executed';
          r.execution = [
            {
              candidateId: r.ranking[0],
              status: 'Executed',
              actionLogId: 'al-1',
            },
          ];
          r.version += 1;
          businessDb.idempotency.set(
            `dec:${request.headers.get('idempotency-key')}`,
            structuredClone(r),
          );
          return HttpResponse.error();
        },
        {once: true},
      ),
    );
    render('/recommendations/rec-203');
    const d = await detail();
    await user.click(within(d).getByRole('button', {name: '确认并执行'}));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', {name: '确认并执行'}));
    await user.click(await within(dialog).findByRole('button', {name: '重试'}));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    const rec = businessDb.recommendations.find(x => x.id === 'rec-203')!;
    expect(rec.execution).toHaveLength(1);
    expect(screen.queryByText('该建议已被处理，已刷新为最新状态')).toBeNull();
    expect(await within(d).findByText('已执行')).toBeInTheDocument();
  });

  it('a new opening of the dialog uses a new key', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    server.use(
      http.post(`${API}/recommendations/:id/decision`, ({request}) => {
        keys.push(request.headers.get('idempotency-key') ?? '');
        return HttpResponse.error();
      }),
    );
    render('/recommendations/rec-203');
    const d = await detail();
    for (let i = 0; i < 2; i++) {
      await user.click(within(d).getByRole('button', {name: '确认并执行'}));
      const dialog = await screen.findByRole('dialog');
      await user.click(
        within(dialog).getByRole('button', {name: '确认并执行'}),
      );
      await within(dialog).findByRole('alert');
      await user.click(within(dialog).getByRole('button', {name: '取消'}));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('reject requires a reason', async () => {
    const user = userEvent.setup();
    render('/recommendations/rec-203');
    const d = await detail();
    await user.click(within(d).getByRole('button', {name: '驳回'}));
    const dialog = await screen.findByRole('dialog', {name: '驳回建议'});
    const submit = within(dialog).getByRole('button', {name: '确认驳回'});
    expect(submit).toBeDisabled();
    const reason = within(dialog).getByLabelText(/驳回原因/);
    await user.type(reason, '   ');
    expect(submit).toBeDisabled();
    await user.clear(reason);
    await user.type(reason, '单价过高');
    expect(within(dialog).getByText('4 / 500')).toBeInTheDocument();
    await user.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sent = decisionRequests();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({decision: 'reject', reason: '单价过高'});
    expect(sent[0].headers['idempotency-key']).toBeTruthy();
    expect(await within(d).findByText('已驳回')).toBeInTheDocument();
  });

  it('rolls the optimistic status back on 500 and shows the error', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/recommendations/:id/decision`, async () => {
        await delay(80);
        return problem(500, 'INTERNAL');
      }),
    );
    render('/recommendations/rec-203');
    const d = await detail();
    await user.click(within(d).getByRole('button', {name: '确认并执行'}));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', {name: '确认并执行'}));
    // Optimistic update while the request is in flight.
    expect(await within(d).findByText('已确认')).toBeInTheDocument();
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(d).queryByText('已确认')).not.toBeInTheDocument(),
    );
    expect(within(d).getAllByText('待确认').length).toBeGreaterThan(0);
  });

  it('409 CONFLICT: says it was already handled, rolls back and refetches', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/recommendations/:id/decision`, () => {
        // Someone else handled it meanwhile.
        const r = businessDb.recommendations.find(x => x.id === 'rec-203')!;
        r.status = 'Rejected';
        r.rejectReason = '已在其他窗口处理';
        return problem(409, 'CONFLICT');
      }),
    );
    render('/recommendations/rec-203');
    const d = await detail();
    await user.click(within(d).getByRole('button', {name: '确认并执行'}));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', {name: '确认并执行'}));
    expect(
      await within(dialog).findByText('该建议已被处理，已刷新为最新状态'),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', {name: '确认并执行'}),
    ).toBeNull();
    // Refetched: the latest state is shown.
    expect(await within(d).findByText('已驳回')).toBeInTheDocument();
  });
});
