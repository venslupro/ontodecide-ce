/**
 * @fileoverview Automations page: list summaries, create with the condition
 * builder (dry run before save, body matches the contract), toggle, delete
 * and validation.
 */

import {automationDefSchema} from '@ontodecide/situation/contract';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {db, problem} from '../../test/handlers';
import {operatorUser} from '../../test/fixtures';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {AutomationsPage} from './automations_page';

describe('AutomationsPage', () => {
  it('lists rules with readable trigger, condition, effects and cooldown', async () => {
    renderWithProviders(<AutomationsPage />, {
      url: '/automations',
      user: operatorUser,
    });
    const rows = await screen.findAllByTestId('automation-row');
    expect(rows).toHaveLength(2);
    const risk = rows[0];
    expect(within(risk).getByText('供应商风险过高')).toBeInTheDocument();
    expect(
      await within(risk).findByText('对象变更时 · 供应商'),
    ).toBeInTheDocument();
    expect(within(risk).getByText('风险分 大于等于 70')).toBeInTheDocument();
    expect(within(risk).getByText('告警')).toBeInTheDocument();
    expect(within(risk).getByText(/生成建议/)).toBeInTheDocument();
    expect(within(risk).getByText('高')).toBeInTheDocument();
    expect(within(risk).getByText('1 小时')).toBeInTheDocument();
    expect(within(rows[1]).getByText('库存天数 小于 5')).toBeInTheDocument();
    expect(within(rows[1]).getByText('从未触发')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', {name: '启用规则：供应商风险过高'}),
    ).toBeChecked();
  });

  it('creates a rule: condition builder → dry run → confirm → POST matching the contract', async () => {
    let posted: unknown;
    let dryBody: unknown;
    server.use(
      http.post('*/api/v1/automations', async ({request}) => {
        posted = await request.json();
        return HttpResponse.json(
          {
            ...(posted as object),
            id: 'auto-new',
            cooldownSec: 3600,
            enabled: true,
            createdAt: '2026-09-24T08:00:00.000Z',
          },
          {status: 201},
        );
      }),
      http.post(/\/api\/v1\/automations:dry-run$/, async ({request}) => {
        dryBody = await request.json();
        return HttpResponse.json({
          wouldFire: 2,
          sample: ['ri.t1.Supplier.S002', 'ri.t1.Supplier.S004'],
        });
      }),
    );
    renderWithProviders(<AutomationsPage />, {
      url: '/automations',
      user: operatorUser,
    });
    const user = userEvent.setup();
    await screen.findAllByTestId('automation-row');
    await user.click(screen.getByRole('button', {name: '新建规则'}));
    const dialog = await screen.findByRole('dialog', {name: '新建自动化规则'});

    await user.type(
      within(dialog).getByLabelText(/名称（中文）/),
      '高风险供应商告警',
    );
    await user.selectOptions(
      within(dialog).getByLabelText(/对象类型/),
      'Supplier',
    );
    await user.click(within(dialog).getByRole('button', {name: '添加条件'}));
    const row = within(dialog).getByRole('group', {name: '条件 1'});
    await user.selectOptions(
      within(row).getByRole('combobox', {name: '属性'}),
      'riskScore',
    );
    await user.selectOptions(
      within(row).getByRole('combobox', {name: '算子'}),
      'gte',
    );
    await user.type(within(row).getByRole('spinbutton', {name: '值'}), '70');
    await user.selectOptions(within(dialog).getByLabelText('严重级'), 'HIGH');

    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    const confirm = await screen.findByRole('dialog', {name: '确认保存'});
    expect(within(confirm).getByTestId('dry-run-result')).toHaveTextContent(
      '最近数据将触发 2 次',
    );
    expect(
      within(confirm).getByRole('link', {name: 'ri.t1.Supplier.S002'}),
    ).toHaveAttribute('href', '/objects/rid/ri.t1.Supplier.S002');
    expect(within(confirm).getByText('风险分 大于等于 70')).toBeInTheDocument();
    // Nothing persisted before confirmation.
    expect(posted).toBeUndefined();
    expect(automationDefSchema.safeParse(dryBody).success).toBe(true);

    await user.click(within(confirm).getByRole('button', {name: '确认保存'}));
    await waitFor(() => expect(posted).toBeDefined());
    expect(automationDefSchema.safeParse(posted).success).toBe(true);
    expect(posted).toEqual({
      name: {'zh-CN': '高风险供应商告警'},
      trigger: {kind: 'threshold', objectType: 'Supplier'},
      condition: {op: 'gte', prop: 'riskScore', value: 70},
      effects: [{kind: 'alert'}],
      severity: 'HIGH',
      cooldownSec: 3600,
      enabled: true,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('规则已保存')).toBeInTheDocument();
  });

  it('runs a standalone dry run and validates required fields', async () => {
    renderWithProviders(<AutomationsPage />, {
      url: '/automations',
      user: operatorUser,
    });
    const user = userEvent.setup();
    await screen.findAllByTestId('automation-row');
    await user.click(screen.getByRole('button', {name: '新建规则'}));
    const dialog = await screen.findByRole('dialog', {name: '新建自动化规则'});
    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    expect(
      await within(dialog).findByText('请输入规则名称'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('请选择对象类型')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/名称（中文）/), 'x');
    await user.selectOptions(
      within(dialog).getByLabelText(/对象类型/),
      'Product',
    );
    await user.click(within(dialog).getByRole('button', {name: '试运行'}));
    expect(
      await within(dialog).findByTestId('dry-run-result'),
    ).toHaveTextContent('最近数据将触发 2 次');
    expect(
      screen.getByRole('dialog', {name: '新建自动化规则'}),
    ).toBeInTheDocument();
  });

  it('shows the dry-run error and stays in the editor', async () => {
    server.use(
      http.post(/\/api\/v1\/automations:dry-run$/, () =>
        problem(400, 'VALIDATION_FAILED'),
      ),
    );
    renderWithProviders(<AutomationsPage />, {
      url: '/automations',
      user: operatorUser,
    });
    const user = userEvent.setup();
    await screen.findAllByTestId('automation-row');
    await user.click(screen.getByRole('button', {name: '新建规则'}));
    const dialog = await screen.findByRole('dialog', {name: '新建自动化规则'});
    await user.type(within(dialog).getByLabelText(/名称（中文）/), 'x');
    await user.selectOptions(
      within(dialog).getByLabelText(/对象类型/),
      'Product',
    );
    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    expect(
      await within(dialog).findByText('试运行失败：输入不合法，请检查后重试'),
    ).toBeInTheDocument();
  });

  it('toggles a rule with PUT', async () => {
    renderWithProviders(<AutomationsPage />, {
      url: '/automations',
      user: operatorUser,
    });
    const user = userEvent.setup();
    const sw = await screen.findByRole('switch', {name: '启用规则：库存不足'});
    await user.click(sw);
    await waitFor(() =>
      expect(db.automations.find(a => a.id === 'auto-inv')?.enabled).toBe(
        false,
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('switch', {name: '启用规则：库存不足'}),
      ).not.toBeChecked(),
    );
  });

  it('deletes a rule after confirmation', async () => {
    renderWithProviders(<AutomationsPage />, {
      url: '/automations',
      user: operatorUser,
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {name: '删除规则：库存不足'}),
    );
    const dialog = await screen.findByRole('dialog', {name: '删除规则'});
    await user.click(within(dialog).getByRole('button', {name: '删除'}));
    await waitFor(() =>
      expect(screen.getAllByTestId('automation-row')).toHaveLength(1),
    );
    expect(db.automations.map(a => a.id)).toEqual(['auto-risk']);
  });

  it('edits an existing rule prefilled from the list', async () => {
    renderWithProviders(<AutomationsPage />, {
      url: '/automations',
      user: operatorUser,
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {name: '编辑规则：供应商风险过高'}),
    );
    const dialog = await screen.findByRole('dialog', {name: '编辑自动化规则'});
    expect(within(dialog).getByLabelText(/名称（中文）/)).toHaveValue(
      '供应商风险过高',
    );
    expect(within(dialog).getByLabelText(/对象类型/)).toHaveValue('Supplier');
    const row = within(dialog).getByRole('group', {name: '条件 1'});
    expect(within(row).getByRole('combobox', {name: '属性'})).toHaveValue(
      'riskScore',
    );
    expect(within(dialog).getByLabelText('扰动属性')).toHaveValue('capacity');
    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    const confirm = await screen.findByRole('dialog', {name: '确认保存'});
    await user.click(within(confirm).getByRole('button', {name: '确认保存'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(db.automations.find(a => a.id === 'auto-risk')?.effects).toEqual([
      {kind: 'alert'},
      {kind: 'recommend', perturbation: {property: 'capacity', change: -0.6}},
    ]);
  });
});
