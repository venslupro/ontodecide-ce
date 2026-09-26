/**
 * @fileoverview Users admin page: list, create with a one-time temporary
 * password, inline role change, self-protection.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {db} from '../../test/handlers';
import {renderApp} from '../../test/render';
import {server} from '../../test/server';

function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('tr')!;
}

describe('UsersPage', () => {
  it('lists users with role, markings and status', async () => {
    renderApp('/admin/users');
    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    const row = rowOf('operator@example.com');
    expect(within(row).getByText('Otto Operator')).toBeInTheDocument();
    expect(
      within(row).getByRole('combobox', {name: 'Otto Operator 的角色'}),
    ).toHaveValue('Operator');
    expect(within(row).getByText('启用')).toBeInTheDocument();
    const admin = rowOf('admin@example.com');
    expect(within(admin).getByText('PII')).toBeInTheDocument();
    expect(within(admin).getByText('FINANCE')).toBeInTheDocument();
  });

  it('shows the temporary password once after creating a user', async () => {
    renderApp('/admin/users');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: '新建用户'}));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/邮箱/), 'new@example.com');
    await user.type(within(dialog).getByLabelText(/姓名/), 'Nina New');
    await user.selectOptions(within(dialog).getByLabelText(/角色/), 'Operator');
    await user.click(within(dialog).getByRole('button', {name: '新建'}));

    const secret = await screen.findByRole('dialog', {name: '用户已创建'});
    expect(within(secret).getByText('Tmp-9xQ2-kLm7')).toBeInTheDocument();
    expect(within(secret).getByText(/只显示这一次/)).toBeInTheDocument();
    expect(db.users.find(u => u.email === 'new@example.com')?.role).toBe(
      'Operator',
    );

    await user.click(
      within(secret).getByRole('button', {name: '我已保存，关闭'}),
    );
    await waitFor(() =>
      expect(screen.queryByText('Tmp-9xQ2-kLm7')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
  });

  it('changes a role with PATCH', async () => {
    let patch: {id?: string; body?: unknown} = {};
    server.use(
      http.patch('*/api/v1/users/:id', async ({params, request}) => {
        patch = {id: params.id as string, body: await request.json()};
        const u = db.users.find(x => x.id === params.id)!;
        Object.assign(u, patch.body);
        return HttpResponse.json(u);
      }),
    );
    renderApp('/admin/users');
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', {
      name: 'Otto Operator 的角色',
    });
    await user.selectOptions(select, 'Modeler');
    await waitFor(() =>
      expect(patch).toEqual({id: 'operator', body: {role: 'Modeler'}}),
    );
    expect(
      await screen.findByText('Otto Operator 的角色已改为建模者'),
    ).toBeInTheDocument();
  });

  it('prevents deleting, disabling or demoting yourself', async () => {
    renderApp('/admin/users');
    const del = await screen.findByRole('button', {name: '删除 Ada Admin'});
    expect(del).toBeDisabled();
    expect(screen.getByRole('switch', {name: '启用 Ada Admin'})).toBeDisabled();
    expect(
      screen.getByRole('combobox', {name: 'Ada Admin 的角色'}),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {name: '删除 Vera Viewer'}),
    ).toBeEnabled();
  });

  it('deletes another user after typing the email', async () => {
    renderApp('/admin/users');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {name: '删除 Vera Viewer'}),
    );
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {name: '删除用户'});
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('输入邮箱 viewer@example.com 以确认'),
      'viewer@example.com',
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(screen.queryByText('viewer@example.com')).not.toBeInTheDocument(),
    );
    expect(db.users.some(u => u.id === 'viewer')).toBe(false);
  });

  it('resets a password and shows it once', async () => {
    renderApp('/admin/users');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {name: '重置 Otto Operator 的密码'}),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '重置密码',
      }),
    );
    const secret = await screen.findByRole('dialog', {name: '密码已重置'});
    expect(within(secret).getByText('Tmp-Reset-4821')).toBeInTheDocument();
    await user.click(
      within(secret).getByRole('button', {name: '我已保存，关闭'}),
    );
    await waitFor(() =>
      expect(screen.queryByText('Tmp-Reset-4821')).not.toBeInTheDocument(),
    );
  });
});
