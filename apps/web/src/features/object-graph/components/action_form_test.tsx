/**
 * @fileoverview Action form: generated from ParamDefs (defaults, objectRef
 * suggestions), required validation, If-Match submission and the 409 / 412
 * / 422 error UX.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import type {UiActionType} from '../../../entities/schema/model';
import {products, rid, suppliers} from '../../../test/fixtures';
import {problem} from '../../../test/handlers';
import {renderWithProviders} from '../../../test/render';
import {server} from '../../../test/server';
import {ActionForm} from './action_form';

const target = products[1];

const action: UiActionType = {
  apiName: 'increaseSafetyStock',
  displayName: '提高安全库存',
  targetType: 'Product',
  parameters: [
    {
      apiName: 'days',
      displayName: '增加天数',
      dataType: 'integer',
      required: true,
      defaultValue: 7,
    },
    {
      apiName: 'backupSupplier',
      displayName: '备用供应商',
      dataType: 'objectRef:Supplier',
      required: true,
      suggest: {
        objectType: 'Supplier',
        filter: {
          op: 'and',
          args: [
            {op: 'eq', prop: 'status', value: 'active'},
            {op: 'lt', prop: 'riskScore', value: 50},
          ],
        },
        orderBy: {prop: 'riskScore', dir: 'asc'},
      },
    },
    {apiName: 'note', displayName: '备注', dataType: 'string', required: false},
  ],
  requiresApproval: false,
  preconditions: ['增加天数须在 1–30 之间'],
  writeback: 'none',
};

function renderForm(extra: Partial<Parameters<typeof ActionForm>[0]> = {}) {
  return renderWithProviders(
    <ActionForm
      action={action}
      target={{rid: target.rid, version: 3, title: target.title}}
      {...extra}
    />,
    {
      url: `/objects/rid/${target.rid}`,
    },
  );
}

async function pickSuggested(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) {
  await user.click(screen.getByRole('combobox', {name: '备用供应商'}));
  const option = await screen.findByRole('option', {name: new RegExp(title)});
  await user.pointer({keys: '[MouseLeft>]', target: option});
}

describe('ActionForm', () => {
  it('generates fields from ParamDefs with defaults, hints and suggestions', async () => {
    let evalBody: unknown;
    server.use(
      http.post(/\/api\/v1\/object-sets:evaluate$/, async ({request}) => {
        evalBody = await request.json();
        return HttpResponse.json({
          items: [suppliers[2], suppliers[0]],
          nextCursor: null,
        });
      }),
    );
    renderForm();
    const user = userEvent.setup();
    const days = await screen.findByLabelText(/增加天数/);
    expect(days).toHaveAttribute('type', 'number');
    expect(days).toHaveValue(7);
    expect(screen.getByText('增加天数须在 1–30 之间')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', {name: '备用供应商'}));
    const listbox = await screen.findByRole('listbox');
    await waitFor(() =>
      expect(within(listbox).getAllByRole('option').length).toBe(2),
    );
    const names = within(listbox)
      .getAllByRole('option')
      .map(o => o.textContent);
    expect(names[0]).toContain('Penang Semicon');
    expect(names.join()).toContain('Shenzhen Precision Parts');
    expect(names.join()).not.toContain('Hanoi Circuit Works');
    expect(within(listbox).getAllByText('推荐')).toHaveLength(2);
    // Suggest set: the parameter's filter + orderBy, top 5.
    expect(evalBody).toEqual({
      definition: {
        objectType: 'Supplier',
        filter: action.parameters[1].suggest!.filter,
        orderBy: [{prop: 'riskScore', dir: 'asc'}],
      },
      limit: 5,
    });
  });

  it('validates required parameters', async () => {
    renderForm();
    const user = userEvent.setup();
    const days = await screen.findByLabelText(/增加天数/);
    await user.clear(days);
    await user.click(screen.getByRole('button', {name: /执行/}));
    expect(await screen.findAllByText('此项为必填')).toHaveLength(2);
  });

  it('submits parameters with the If-Match object version', async () => {
    let ifMatch: string | null = null;
    let body: unknown;
    server.use(
      http.post('*/api/v1/actions/:type/apply', async ({request}) => {
        ifMatch = request.headers.get('if-match');
        body = await request.json();
        return HttpResponse.json({
          actionLogId: 'al-9',
          actionType: 'increaseSafetyStock',
          rid: target.rid,
          version: 4,
          before: {},
          after: {},
          writebackStatus: 'NONE',
          executedAt: '2026-09-24T08:00:00.000Z',
        });
      }),
    );
    const onDone = vi.fn();
    renderForm({onDone});
    const user = userEvent.setup();
    await screen.findByLabelText(/增加天数/);
    await pickSuggested(user, 'Penang Semicon');
    await user.click(screen.getByRole('button', {name: /执行/}));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(ifMatch).toBe('"3"');
    expect(body).toEqual({
      target: target.rid,
      params: {days: 7, backupSupplier: rid('Supplier', 'S003')},
    });
    expect(
      await screen.findByText('「提高安全库存」已执行'),
    ).toBeInTheDocument();
  });

  it('lists each unmet precondition from a 422', async () => {
    server.use(
      http.post('*/api/v1/actions/:type/apply', () =>
        problem(422, 'PRECONDITION_FAILED', 'unmet', {
          unmet: ['增加天数须在 1–30 之间', '产品必须处于在售状态'],
        }),
      ),
    );
    renderForm();
    const user = userEvent.setup();
    await screen.findByLabelText(/增加天数/);
    await pickSuggested(user, 'Penang Semicon');
    await user.click(screen.getByRole('button', {name: /执行/}));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('前置条件未满足');
    const items = within(alert)
      .getAllByRole('listitem')
      .map(li => li.textContent);
    expect(items).toEqual(['增加天数须在 1–30 之间', '产品必须处于在售状态']);
  });

  it('shows the refresh dialog on 412 and retries with the new version, keeping values', async () => {
    const versions: (string | null)[] = [];
    server.use(
      http.post('*/api/v1/actions/:type/apply', ({request}) => {
        versions.push(request.headers.get('if-match'));
        if (versions.length === 1) return problem(412, 'VERSION_CONFLICT');
        return HttpResponse.json({
          actionLogId: 'al-9',
          actionType: 'increaseSafetyStock',
          rid: target.rid,
          version: 5,
          before: {},
          after: {},
          writebackStatus: 'NONE',
          executedAt: '2026-09-24T08:00:00.000Z',
        });
      }),
    );
    const onRefreshTarget = vi.fn(async () => 4);
    const onDone = vi.fn();
    renderForm({onRefreshTarget, onDone});
    const user = userEvent.setup();
    const days = await screen.findByLabelText(/增加天数/);
    await user.clear(days);
    await user.type(days, '10');
    await pickSuggested(user, 'Penang Semicon');
    await user.click(screen.getByRole('button', {name: /执行/}));
    const dialog = await screen.findByRole('dialog', {
      name: '对象已被他人修改',
    });
    await user.click(within(dialog).getByRole('button', {name: '刷新后重试'}));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onRefreshTarget).toHaveBeenCalled();
    expect(versions).toEqual(['"3"', '"4"']);
    expect(screen.getByLabelText(/增加天数/)).toHaveValue(10);
  });

  it('links to the recommendation on 409 APPROVAL_REQUIRED', async () => {
    server.use(
      http.post('*/api/v1/actions/:type/apply', () =>
        problem(409, 'APPROVAL_REQUIRED', 'needs approval', {
          recommendationId: 'rec-7',
        }),
      ),
    );
    renderForm();
    const user = userEvent.setup();
    await screen.findByLabelText(/增加天数/);
    await pickSuggested(user, 'Penang Semicon');
    await user.click(screen.getByRole('button', {name: /执行/}));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('该动作需要审批，请前往建议中心');
    expect(
      within(alert).getByRole('link', {name: '前往审批该建议'}),
    ).toHaveAttribute('href', '/recommendations/rec-7');
  });
});
