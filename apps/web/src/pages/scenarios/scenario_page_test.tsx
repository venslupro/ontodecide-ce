/**
 * @fileoverview Scenario page: running an existing scenario shows the
 * simulator KPIs, the AI button shows the remaining quota, a new scenario is
 * created before running.
 */

import type {ScenarioInput} from '@ontodecide/decision/contract';
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

describe('ScenarioPage', () => {
  it('runs an existing scenario and shows the simulator KPI values', async () => {
    const bodies: ScenarioInput[] = [];
    server.use(
      http.post('*/api/v1/scenarios/:id/run', async ({request}) => {
        bodies.push((await request.json()) as ScenarioInput);
        return HttpResponse.json(fx.scenarioResult);
      }),
    );
    renderApp('/scenarios/sc-1', {user: fx.operatorUser});
    const user = userEvent.setup();
    const run = await screen.findByRole(
      'button',
      {name: '运行推演'},
      {timeout: 5000},
    );
    await user.click(run);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].perturbations).toEqual([
      {rid: fx.rid('Supplier', 'S002'), property: 'capacity', change: -0.6},
    ]);

    const table = await screen.findByRole('table', {name: 'KPI 对比表'});
    const row = within(table).getByText('可满足日需求').closest('tr')!;
    expect(row).toHaveTextContent('950');
    expect(row).toHaveTextContent('610');
    expect(row).toHaveTextContent('880');
    expect(row).toHaveTextContent('-35.8%');
    expect(row).toHaveTextContent('恶化');
    expect(row).toHaveTextContent('改善');
    expect(screen.getByText('数值来自推演器，不经过 LLM')).toBeInTheDocument();
    expect(screen.getByText('风险 高')).toBeInTheDocument();
  });

  it('shows the remaining AI quota and generates a recommendation', async () => {
    const {router} = renderApp('/scenarios/sc-1', {user: fx.operatorUser});
    expect(
      await screen.findByText('今日剩余 17 次', undefined, {timeout: 5000}),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    const btn = screen.getByRole('button', {name: '生成 AI 建议'});
    await waitFor(() => expect(btn).toBeEnabled());
    await user.click(btn);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/recommendations/rec-1'),
    );
  });

  it('disables AI generation when the quota is used up', async () => {
    server.use(
      http.get('*/api/v1/llm/quota', () =>
        HttpResponse.json({userRemaining: 0, tenantRemaining: 0}),
      ),
    );
    renderApp('/scenarios/sc-1', {user: fx.operatorUser});
    expect(
      await screen.findByText('今日剩余 0 次', undefined, {timeout: 5000}),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '生成 AI 建议'})).toBeDisabled();
    expect(screen.getByText(/今日 AI 次数已用完/)).toBeInTheDocument();
  });

  it('lists candidate actions with approval badges and unmet preconditions', async () => {
    renderApp('/scenarios/sc-1', {user: fx.operatorUser});
    const list = await screen.findByRole(
      'list',
      {name: '候选动作'},
      {timeout: 5000},
    );
    expect(within(list).getAllByText('需审批')).toHaveLength(2);
    expect(
      within(list).getByText('已停用的供应商不能标记'),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole('checkbox', {name: /标记观察/}),
    ).toBeDisabled();
    expect(
      within(list).getByRole('checkbox', {name: /切换供应商/}),
    ).toBeEnabled();
  });

  it('creates a new scenario from ?rid= and then runs it', async () => {
    const before = db.scenarios.length;
    const {router} = renderApp(
      `/scenarios/new?rid=${fx.rid('Supplier', 'S002')}`,
      {user: fx.operatorUser},
    );
    const user = userEvent.setup();
    const prop = await screen.findByRole(
      'combobox',
      {name: '扰动 1 的属性'},
      {timeout: 5000},
    );
    await waitFor(() => expect(prop).toHaveValue('riskScore'));
    await user.selectOptions(prop, 'capacity');
    const pct = screen.getByRole('spinbutton', {
      name: '扰动 1 的相对变化（百分比）',
    });
    await user.clear(pct);
    await user.type(pct, '-40');
    await user.click(screen.getByRole('button', {name: '运行推演'}));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/scenarios/sc-${before + 1}`,
      ),
    );
    expect(db.scenarios[before].perturbations).toEqual([
      {rid: fx.rid('Supplier', 'S002'), property: 'capacity', change: -0.4},
    ]);
    expect(
      await screen.findByRole('table', {name: 'KPI 对比表'}),
    ).toBeInTheDocument();
  });

  it('shows a localized error when the simulation is rejected', async () => {
    server.use(
      http.post('*/api/v1/scenarios/:id/run', () =>
        problem(422, 'GRAPH_TOO_LARGE', 'too many nodes'),
      ),
    );
    renderApp('/scenarios/sc-1', {user: fx.operatorUser});
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {name: '运行推演'}, {timeout: 5000}),
    );
    expect(
      await screen.findByText('关系图过大，请缩小范围'),
    ).toBeInTheDocument();
  });
});
