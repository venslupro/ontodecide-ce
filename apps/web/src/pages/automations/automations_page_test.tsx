/**
 * @fileoverview Automations page: list, enable switch (PUT + If-Match),
 * create a threshold rule with an AND / OR condition, the scheduled-rule
 * limit and minimum interval (save disabled with the reason), 412 conflict
 * dialog, 400 inline error and delete.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import {businessDb} from '../../test/handlers/business';
import {API, problem} from '../../test/handlers/problem';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {AutomationsPage} from './automations_page';

// renderWithProviders does not need the app route tree; mocking it keeps
// this test independent of pages other agents are still writing.
vi.mock('../../app/router', () => ({routeTree: {}}));

type User = ReturnType<typeof userEvent.setup>;

async function renderPage() {
  const r = renderWithProviders(<AutomationsPage />, {url: '/automations'});
  await screen.findAllByTestId('automation-row');
  return r;
}

function requests(method: string, path: string) {
  return businessDb.requests.filter(
    r => r.method === method && r.path === path,
  );
}

async function openCreate(user: User) {
  await user.click(screen.getByRole('button', {name: '新建规则'}));
  return screen.findByRole('dialog', {name: '新建自动化规则'});
}

async function fillScheduled(user: User, dialog: HTMLElement, name: string) {
  await user.type(within(dialog).getByLabelText(/^名称（中文）/), name);
  await user.selectOptions(
    within(dialog).getByLabelText('触发方式'),
    'schedule',
  );
  await user.selectOptions(
    within(dialog).getByLabelText(/^对象类型/),
    'Material',
  );
  await user.click(within(dialog).getByRole('button', {name: '添加条件'}));
  const row = within(dialog).getByRole('group', {name: '条件 1'});
  await user.selectOptions(
    within(row).getByRole('combobox', {name: '属性'}),
    'onHand',
  );
  await user.selectOptions(
    within(row).getByRole('combobox', {name: '算子'}),
    'lt',
  );
  await user.type(within(row).getByRole('spinbutton', {name: '值'}), '10');
}

describe('AutomationsPage', () => {
  it('lists automations with trigger, type, condition, severity and cooldown', async () => {
    await renderPage();
    const rows = screen.getAllByTestId('automation-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('供应商产能下降');
    expect(rows[0]).toHaveTextContent('阈值');
    expect(rows[0]).toHaveTextContent('供应商');
    expect(rows[0]).toHaveTextContent('周产能 小于 5000');
    expect(rows[0]).toHaveTextContent('严重');
    expect(rows[0]).toHaveTextContent('1 小时');
    expect(rows[1]).toHaveTextContent('每 1 小时');
    expect(rows[1]).toHaveTextContent('可供天数 小于 2');
    expect(screen.getByTestId('scheduled-count')).toHaveTextContent(
      '定时规则 1/3',
    );
  });

  it('toggles enabled with PUT, the full definition and If-Match', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('switch', {name: '启用「安全库存巡检」'}),
    );
    await waitFor(() =>
      expect(requests('PUT', '/automations/auto-stock')).toHaveLength(1),
    );
    const req = requests('PUT', '/automations/auto-stock')[0];
    expect(req.headers['if-match']).toBe('"v2"');
    expect(req.body).toEqual({
      name: {'zh-CN': '安全库存巡检', 'en-US': 'Safety stock check'},
      trigger: 'schedule',
      everyHours: 1,
      objectType: 'Material',
      condition: {op: 'lt', prop: 'daysOfSupply', value: 2},
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: false,
    });
    await waitFor(() =>
      expect(
        screen.getByRole('switch', {name: '启用「安全库存巡检」'}),
      ).not.toBeChecked(),
    );
  });

  it('creates a threshold rule with an AND / OR condition', async () => {
    await renderPage();
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    expect(within(dialog).getByTestId('effect-row')).toHaveTextContent(
      '产生告警',
    );
    expect(within(dialog).getByTestId('effect-row')).toHaveTextContent(
      '手动生成',
    );
    await user.type(
      within(dialog).getByLabelText(/^名称（中文）/),
      '高风险供应商',
    );
    await user.type(
      within(dialog).getByLabelText(/^名称（英文）/),
      'Risky suppliers',
    );
    await user.selectOptions(
      within(dialog).getByLabelText(/^对象类型/),
      'Supplier',
    );
    await user.click(within(dialog).getByRole('button', {name: '添加条件'}));
    const r1 = within(dialog).getByRole('group', {name: '条件 1'});
    await user.selectOptions(
      within(r1).getByRole('combobox', {name: '属性'}),
      'riskScore',
    );
    await user.selectOptions(
      within(r1).getByRole('combobox', {name: '算子'}),
      'gte',
    );
    await user.type(within(r1).getByRole('spinbutton', {name: '值'}), '70');
    await user.click(within(dialog).getByRole('button', {name: '添加条件组'}));
    const sub = within(dialog).getByRole('group', {name: '条件组'});
    await user.click(within(sub).getByRole('button', {name: '添加条件'}));
    await user.click(within(sub).getByRole('button', {name: '添加条件'}));
    const [s1, s2] = within(sub).getAllByRole('group', {name: /条件 \d/});
    await user.selectOptions(
      within(s1).getByRole('combobox', {name: '属性'}),
      'status',
    );
    await user.selectOptions(
      within(s1).getByRole('combobox', {name: '值'}),
      'watch',
    );
    await user.selectOptions(
      within(s2).getByRole('combobox', {name: '属性'}),
      'capacityPerWeek',
    );
    await user.selectOptions(
      within(s2).getByRole('combobox', {name: '算子'}),
      'lt',
    );
    await user.type(within(s2).getByRole('spinbutton', {name: '值'}), '5000');
    await user.selectOptions(within(dialog).getByLabelText('严重度'), 'HIGH');
    const cd = within(dialog).getByLabelText(/^冷却/);
    await user.clear(cd);
    await user.type(cd, '600');
    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    await waitFor(() =>
      expect(requests('POST', '/automations')).toHaveLength(1),
    );
    expect(requests('POST', '/automations')[0].body).toEqual({
      name: {'zh-CN': '高风险供应商', 'en-US': 'Risky suppliers'},
      trigger: 'threshold',
      objectType: 'Supplier',
      condition: {
        op: 'and',
        args: [
          {op: 'gte', prop: 'riskScore', value: 70},
          {
            op: 'or',
            args: [
              {op: 'eq', prop: 'status', value: 'watch'},
              {op: 'lt', prop: 'capacityPerWeek', value: 5000},
            ],
          },
        ],
      },
      severity: 'HIGH',
      cooldownSec: 600,
      enabled: true,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('高风险供应商')).toBeInTheDocument();
  });

  it('shows inline validation errors without sending', async () => {
    await renderPage();
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    expect(within(dialog).getByText('请填写中文名称')).toBeInTheDocument();
    expect(
      within(dialog).getByText('至少需要一个完整的条件'),
    ).toBeInTheDocument();
    expect(requests('POST', '/automations')).toHaveLength(0);
  });

  it('allows 3 scheduled rules and disables saving a 4th with the reason', async () => {
    await renderPage();
    const user = userEvent.setup();
    for (const name of ['巡检二', '巡检三']) {
      const dialog = await openCreate(user);
      await fillScheduled(user, dialog, name);
      expect(
        within(dialog).queryByTestId('save-block-reason'),
      ).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', {name: '保存'}));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    }
    expect(requests('POST', '/automations')).toHaveLength(2);
    await waitFor(() =>
      expect(screen.getByTestId('scheduled-count')).toHaveTextContent(
        '定时规则 3/3',
      ),
    );
    const dialog = await openCreate(user);
    await fillScheduled(user, dialog, '巡检四');
    expect(within(dialog).getByTestId('save-block-reason')).toHaveTextContent(
      '每个工作区最多 3 条定时规则',
    );
    expect(within(dialog).getByRole('button', {name: '保存'})).toBeDisabled();
    // Switching back to a threshold rule re-enables saving.
    await user.selectOptions(
      within(dialog).getByLabelText('触发方式'),
      'threshold',
    );
    expect(within(dialog).getByRole('button', {name: '保存'})).toBeEnabled();
  });

  it('disables saving when the interval is below 1 hour', async () => {
    await renderPage();
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await fillScheduled(user, dialog, '太频繁');
    const hours = within(dialog).getByLabelText(/^间隔（小时）/);
    await user.clear(hours);
    await user.type(hours, '0');
    expect(within(dialog).getByTestId('save-block-reason')).toHaveTextContent(
      '定时间隔最少 1 小时',
    );
    expect(within(dialog).getByRole('button', {name: '保存'})).toBeDisabled();
    await user.clear(hours);
    await user.type(hours, '2');
    expect(within(dialog).getByRole('button', {name: '保存'})).toBeEnabled();
  });

  it('opens the conflict dialog on 412 when editing', async () => {
    server.use(
      http.put(`${API}/automations/:id`, () =>
        problem(412, 'PRECONDITION_FAILED'),
      ),
    );
    await renderPage();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', {name: '编辑「供应商产能下降」'}),
    );
    const dialog = await screen.findByRole('dialog', {name: '编辑自动化规则'});
    const name = within(dialog).getByLabelText(/^名称（中文）/);
    await user.clear(name);
    await user.type(name, '产能告急');
    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    const conflict = await screen.findByRole('dialog', {
      name: '内容已在其他窗口修改',
    });
    await user.click(within(conflict).getByRole('button', {name: '查看差异'}));
    expect(
      await within(conflict).findByRole('table', {name: '查看差异'}),
    ).toHaveTextContent('产能告急');
    await user.click(
      within(conflict).getByRole('button', {name: '刷新并放弃我的修改'}),
    );
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('dialog', {name: '编辑自动化规则'}),
        ).getByLabelText(/^名称（中文）/),
      ).toHaveValue('供应商产能下降'),
    );
  });

  it('shows a 400 VALIDATION_FAILED inline', async () => {
    server.use(
      http.post(`${API}/automations`, () =>
        problem(400, 'VALIDATION_FAILED', 'bad', {
          errors: [{path: 'condition', message: 'unknown property'}],
        }),
      ),
    );
    await renderPage();
    const user = userEvent.setup();
    const dialog = await openCreate(user);
    await fillScheduled(user, dialog, '服务器拒绝');
    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    expect(
      await within(dialog).findByText(
        '服务器校验未通过：condition: unknown property',
      ),
    ).toBeInTheDocument();
  });

  it('deletes a rule after confirmation with If-Match', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', {name: '删除「供应商产能下降」'}),
    );
    const dialog = await screen.findByRole('dialog', {name: '删除规则？'});
    expect(dialog).toHaveTextContent('确定删除「供应商产能下降」吗？');
    await user.click(within(dialog).getByRole('button', {name: '删除'}));
    await waitFor(() =>
      expect(screen.getAllByTestId('automation-row')).toHaveLength(1),
    );
    const req = requests('DELETE', '/automations/auto-cap')[0];
    expect(req.headers['if-match']).toBe('"v1"');
  });
});
