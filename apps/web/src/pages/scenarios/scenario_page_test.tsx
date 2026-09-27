/**
 * @fileoverview Scenario page: stored scenario (KPI table, deterministic
 * note, impact header), new scenario (add perturbation, slider, run → POST
 * body), the 10-perturbation limit, and 「生成 AI 建议」 (remaining quota,
 * navigation, rule-ranked hint, inline 429).
 */

import {act, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import {useSession} from '../../entities/session/store';
import {S017} from '../../test/fixtures';
import {businessDb} from '../../test/handlers/business';
import {API, problem} from '../../test/handlers/problem';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {ScenarioPage} from './scenario_page';

// The page is rendered on its own; the app route tree is not needed.
vi.mock('../../app/router', () => ({routeTree: undefined}));

/** Serves GET /me with the business quotas and signs the store in. */
function signedIn() {
  server.use(
    http.get(`${API}/me`, () =>
      HttpResponse.json({
        userId: 'u-owner',
        email: 'owner@example.com',
        role: 'owner',
        locale: 'zh-CN',
        timeZone: 'Asia/Shanghai',
        workspace: {},
        sessions: {used: 1, limit: 3},
        quotas: businessDb.quotas,
      }),
    ),
  );
  act(() =>
    useSession.getState().setGrant({accessToken: 'token-0', expiresIn: 900}),
  );
}

function render(url: string) {
  const r = renderWithProviders(<ScenarioPage />, {url});
  signedIn();
  return r;
}

describe('ScenarioPage', () => {
  it('shows a stored scenario: KPI table with the best candidate and the deterministic note', async () => {
    render('/scenarios/scn-041');
    expect(
      await screen.findByRole('heading', {name: 'S-017 产能下降影响评估'}),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table', {name: 'KPI 对比表'});
    const rows = within(table).getAllByTestId('kpi-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('准时交付率')).toBeInTheDocument();
    expect(within(rows[0]).getByText('91.4%')).toBeInTheDocument();
    expect(within(rows[0]).getByText('84%')).toBeInTheDocument();
    // Best candidate c1 (highest expected impact).
    expect(within(rows[0]).getByText('90.2%')).toBeInTheDocument();
    expect(within(rows[0]).getByText('恶化')).toBeInTheDocument();
    expect(within(rows[1]).getByText('37')).toBeInTheDocument();
    expect(within(rows[1]).getByText('61')).toBeInTheDocument();
    expect(within(rows[1]).getByText('29')).toBeInTheDocument();
    expect(
      screen.getByText('数值由确定性推演器计算，不经过 LLM'),
    ).toBeInTheDocument();
    expect(screen.getByText('2 跳 · 3 个对象')).toBeInTheDocument();
    expect(
      screen.getByText('节点大小与颜色深浅 = 影响程度'),
    ).toBeInTheDocument();
    expect(screen.getByText('高风险')).toBeInTheDocument();
    // Perturbations are loaded into the editor.
    expect(screen.getAllByTestId('perturbation')).toHaveLength(1);
    expect(screen.getByTestId('perturbation-value')).toHaveTextContent('-60%');
  });

  it('new scenario: add a perturbation, set the slider, run → POST body and navigation', async () => {
    const user = userEvent.setup();
    const {router} = render('/scenarios');
    await screen.findByText('新建情景');
    expect(screen.getByRole('button', {name: '运行推演'})).toBeDisabled();
    await user.click(screen.getByRole('button', {name: '添加扰动'}));
    expect(screen.getByTestId('perturbation-count')).toHaveTextContent(
      '1 / 10',
    );

    await user.click(screen.getByRole('combobox', {name: '对象 1'}));
    await user.type(screen.getByRole('combobox', {name: '对象 1'}), '苏州');
    const option = await screen.findByRole('option', {name: /苏州精密零件/});
    await user.pointer({keys: '[MouseLeft>]', target: option});
    await user.pointer({keys: '[/MouseLeft]', target: option});

    const select = screen.getByRole('combobox', {name: '属性 1'});
    await waitFor(() => expect(select).toBeEnabled());
    await user.selectOptions(select, 'capacityPerWeek');

    const slider = screen.getByRole('slider', {name: '扰动 1 相对变化'});
    act(() => slider.focus());
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(screen.getByTestId('perturbation-value')).toHaveTextContent('-20%');

    await user.click(screen.getByRole('button', {name: '运行推演'}));
    await waitFor(() =>
      expect(
        businessDb.requests.some(
          r => r.method === 'POST' && r.path === '/scenarios',
        ),
      ).toBe(true),
    );
    const req = businessDb.requests.find(
      r => r.method === 'POST' && r.path === '/scenarios',
    )!;
    expect(req.body).toMatchObject({
      perturbations: [{rid: S017, property: 'capacityPerWeek', change: -0.2}],
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/scenarios\/scn-\d+$/),
    );
    expect(
      await screen.findByRole('table', {name: 'KPI 对比表'}),
    ).toBeInTheDocument();
  });

  it('prefills a perturbation from ?rid=', async () => {
    render(`/scenarios?rid=${S017}`);
    expect(await screen.findByTestId('perturbation')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '运行推演'})).toBeEnabled();
  });

  it('disables 添加扰动 at 10 perturbations', async () => {
    const user = userEvent.setup();
    render('/scenarios');
    const add = await screen.findByRole('button', {name: '添加扰动'});
    for (let i = 0; i < 10; i++) await user.click(add);
    expect(screen.getAllByTestId('perturbation')).toHaveLength(10);
    expect(screen.getByTestId('perturbation-count')).toHaveTextContent(
      '10 / 10',
    );
    expect(add).toBeDisabled();
    expect(screen.getByText('每个情景最多 10 项扰动')).toBeInTheDocument();
  });

  it('generates an AI recommendation: shows remaining quota and navigates', async () => {
    const user = userEvent.setup();
    const {router} = render('/scenarios/scn-041');
    expect(await screen.findByText('今日剩余 2/3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: '生成 AI 建议'}));
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(
        /^\/recommendations\/rec-\d+$/,
      ),
    );
    const req = businessDb.requests.find(
      r => r.method === 'POST' && r.path === '/recommendations',
    );
    expect(req?.body).toEqual({focus: S017, scenarioId: 'scn-041'});
    expect(businessDb.recommendations[0].rankedBy).toBe('ai');
  });

  it('explains rule ranking when the AI quota is used up and still generates', async () => {
    const user = userEvent.setup();
    businessDb.quotas.aiRecsToday.used = 3;
    render('/scenarios/scn-041');
    expect(await screen.findByText('今日剩余 0/3')).toBeInTheDocument();
    expect(
      screen.getByText('今日 AI 额度已用完，仍可生成，结果将按规则排序'),
    ).toBeInTheDocument();
    const btn = screen.getByRole('button', {name: '生成 AI 建议'});
    expect(btn).toBeEnabled();
    await user.click(btn);
    await waitFor(() =>
      expect(businessDb.recommendations[0].rankedBy).toBe('rules'),
    );
  });

  it('shows QUOTA_EXCEEDED inline next to the button', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API}/recommendations`, () =>
        problem(429, 'QUOTA_EXCEEDED', undefined, {
          quota: 'aiRecsToday',
          resetsAt: '2026-09-29T00:00:00.000Z',
        }),
      ),
    );
    render('/scenarios/scn-041');
    await screen.findByRole('table', {name: 'KPI 对比表'});
    await user.click(screen.getByRole('button', {name: '生成 AI 建议'}));
    expect(await screen.findByRole('status')).toHaveTextContent(
      /AI 建议已用完/,
    );
  });
});
