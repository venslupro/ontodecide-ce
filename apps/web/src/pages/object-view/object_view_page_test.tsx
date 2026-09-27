/**
 * @fileoverview Object View: ontology-driven properties with lineage,
 * action menu limited to satisfied preconditions, execution with
 * Idempotency-Key + If-Match (replay-safe), inline merge-patch edit and the
 * 412 conflict dialog, related alerts / recommendations, 404 state.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http} from 'msw';
import {describe, expect, it} from 'vitest';
import {S017} from '../../test/fixtures/business';
import {businessDb} from '../../test/handlers/business';
import {API, problem} from '../../test/handlers/problem';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {ObjectViewPage} from './object_view_page';

const url = `/objects/${S017}`;

describe('ObjectViewPage', () => {
  it('renders header, properties with provenance and related items', async () => {
    renderWithProviders(<ObjectViewPage />, {url});
    expect(
      await screen.findByRole('heading', {name: '苏州精密零件有限公司'}),
    ).toBeInTheDocument();
    expect(screen.getByText(`${S017} · v14`)).toBeInTheDocument();
    expect(screen.getAllByText('文件导入 imp-0412').length).toBeGreaterThan(0);
    expect(screen.getByText('（未导入）')).toBeInTheDocument(); // contactEmail
    expect(screen.getAllByText(/第 3 行/).length).toBeGreaterThan(0); // lineage
    expect(
      await screen.findByText('供应商 S-017 产能下降 60%'),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('link', {name: 'PO-5530 切换至备选供应商 S-022'}),
    ).toBeInTheDocument();
  });

  it('lists only actions whose preconditions hold and executes with headers', async () => {
    renderWithProviders(<ObjectViewPage />, {url});
    await userEvent.click(
      await screen.findByRole('button', {name: /执行动作/}),
    );
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByRole('menuitem', {name: '暂停供应商'}),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', {name: '恢复供应商'}),
    ).toBeNull();
    await userEvent.click(
      within(menu).getByRole('menuitem', {name: '暂停供应商'}),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', {name: '执行'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const req = businessDb.requests.find(
      r => r.path === '/action-types/suspendSupplier/executions',
    )!;
    expect(req.headers['if-match']).toBe('"v14"');
    expect(req.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.body).toEqual({target: S017, params: {}});
  });

  it('reuses the Idempotency-Key when retrying after a network failure', async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/action-types/:id/executions`, ({request}) => {
        calls += 1;
        if (calls === 1) {
          businessDb.requests.push({
            method: 'POST',
            path: '/fail',
            headers: {
              'idempotency-key': request.headers.get('idempotency-key') ?? '',
            },
            body: undefined,
          });
          return Response.error();
        }
        return undefined;
      }),
    );
    renderWithProviders(<ObjectViewPage />, {url});
    await userEvent.click(
      await screen.findByRole('button', {name: /执行动作/}),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', {name: '暂停供应商'}),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', {name: '执行'}));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', {name: '执行'}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const first = businessDb.requests.find(r => r.path === '/fail')!;
    const second = businessDb.requests.find(
      r => r.path === '/action-types/suspendSupplier/executions',
    )!;
    expect(second.headers['idempotency-key']).toBe(
      first.headers['idempotency-key'],
    );
  });

  it('edits properties with a merge patch and If-Match', async () => {
    renderWithProviders(<ObjectViewPage />, {url});
    await userEvent.click(await screen.findByRole('button', {name: '编辑'}));
    const input = screen.getByLabelText('country');
    await userEvent.clear(input);
    await userEvent.type(input, 'JP');
    await userEvent.click(screen.getByRole('button', {name: '保存'}));
    await waitFor(() =>
      expect(businessDb.requests.some(r => r.method === 'PATCH')).toBe(true),
    );
    const req = businessDb.requests.find(r => r.method === 'PATCH')!;
    expect(req.headers['content-type']).toContain(
      'application/merge-patch+json',
    );
    expect(req.headers['if-match']).toBe('"v14"');
    expect(req.body).toEqual({country: 'JP'});
    expect(await screen.findByText(`${S017} · v15`)).toBeInTheDocument();
  });

  it('shows the 412 conflict dialog with refresh and diff', async () => {
    server.use(
      http.patch(`${API}/objects/:rid`, () =>
        problem(412, 'PRECONDITION_FAILED'),
      ),
    );
    renderWithProviders(<ObjectViewPage />, {url});
    await userEvent.click(await screen.findByRole('button', {name: '编辑'}));
    const input = screen.getByLabelText('country');
    await userEvent.clear(input);
    await userEvent.type(input, 'DE');
    await userEvent.click(screen.getByRole('button', {name: '保存'}));
    const dialog = await screen.findByRole('dialog', {
      name: '内容已在其他窗口修改',
    });
    await userEvent.click(
      within(dialog).getByRole('button', {name: '查看差异'}),
    );
    const diff = await within(dialog).findByRole('table');
    expect(within(diff).getByText('DE')).toBeInTheDocument();
    expect(within(diff).getByText('CN')).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', {name: '刷新并放弃我的修改'}),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a not-found state', async () => {
    renderWithProviders(<ObjectViewPage />, {
      url: '/objects/ri.Supplier.01J90000000000000000009999',
    });
    expect(await screen.findByText('对象不存在或已被删除')).toBeInTheDocument();
  });
});
