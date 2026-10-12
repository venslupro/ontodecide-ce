/**
 * @fileoverview /account: lifecycle timeline, account rows, archive
 * preview, export to a .jsonl Blob, early termination → /ended; admin
 * variant without timeline and danger zone.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {useSession} from '../../entities/session/store';
import {ADMIN_TID, adminMe, ownerMe} from '../../test/fixtures/platform';
import {shortTid} from '../../shared/lib/format';
import {businessDb} from '../../test/handlers/business';
import {platformDb, recorded, TEST_CODE} from '../../test/handlers/platform';
import {renderApp} from '../../test/render';
import {lifecycleMilestones} from './account_page';

const H = 3_600_000;

describe('lifecycleMilestones', () => {
  it('marks passed steps done and the next one current', () => {
    const v = 0;
    const m = lifecycleMilestones(v, 72 * H, 50 * H);
    expect(m.map(x => x.state)).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ]);
    expect(m[1].at).toBe(48 * H);
    expect(m[4].at).toBe(72 * H + 7 * 24 * H);
    expect(lifecycleMilestones(v, 72 * H, H).map(x => x.state)[1]).toBe(
      'current',
    );
  });
});

describe('AccountPage (owner)', () => {
  it('shows the lifecycle, account, archive preview and exports a .jsonl file', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    renderApp('/account', {me: ownerMe(20)});
    expect(
      await screen.findByRole('heading', {name: '账户与数据'}),
    ).toBeInTheDocument();
    const tl = screen.getByRole('list', {name: '试用生命周期'});
    expect(within(tl).getAllByRole('listitem')).toHaveLength(5);
    expect(within(tl).getByText('试用到期').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByText('邮箱验证码 · 无密码')).toBeInTheDocument();
    expect(screen.getByText(/所有者（每个工作区唯一）/)).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    for (const f of [
      'ontology.json',
      'objects.jsonl',
      'links.jsonl',
      'audit.jsonl',
    ])
      expect(screen.getByText(f)).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: '立即导出一份'}));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.download).toMatch(/^ontodecide-export-\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(recorded('GET', '/me/export')[0].headers.accept).toBe(
      'application/jsonl',
    );
    click.mockRestore();
  });

  it('clears the workspace after confirmation and returns to the cockpit', async () => {
    businessDb.sampleLoaded = true;
    const user = userEvent.setup();
    const {router} = renderApp('/account');
    await user.click(await screen.findByRole('button', {name: '清空工作区'}));
    const dialog = await screen.findByRole('dialog', {name: '确认清空工作区'});
    expect(
      within(dialog).getByText(/本体（恢复为空白模板/),
    ).toBeInTheDocument();
    expect(businessDb.sampleLoaded).toBe(true);
    await user.click(within(dialog).getByRole('button', {name: '确认清空'}));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/cockpit'),
    );
    expect(businessDb.sampleLoaded).toBe(false);
    expect(
      businessDb.requests.filter(r => r.path === '/workspace/clear'),
    ).toHaveLength(1);
    expect(
      await screen.findByText('工作区已清空（删除 80 个对象、160 条关系）'),
    ).toBeInTheDocument();
  });

  it('ends the trial with an e-mail code and lands on /ended', async () => {
    const user = userEvent.setup();
    const {router, queryClient} = renderApp('/account');
    await user.click(await screen.findByRole('button', {name: '结束试用'}));
    await user.click(await screen.findByRole('button', {name: '发送验证码'}));
    expect(recorded('POST', '/me/codes')[0].body).toEqual({
      purpose: 'terminate',
    });
    const boxes = await screen.findAllByRole('textbox', {name: /6 位验证码/});
    await user.click(boxes[0]);
    await user.keyboard(TEST_CODE);
    await waitFor(() => expect(router.state.location.pathname).toBe('/ended'));
    expect(platformDb.terminated).toBe(true);
    expect(recorded('POST', '/me/trial/termination')[0].body).toEqual({
      code: TEST_CODE,
    });
    expect(useSession.getState().accessToken).toBeUndefined();
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
  });
});

describe('AccountPage (admin)', () => {
  it('replaces the timeline and hides the trial termination', async () => {
    renderApp('/account', {as: 'admin', me: adminMe()});
    expect(
      await screen.findByText('平台管理员 · 不过期 · 不可删除'),
    ).toBeInTheDocument();
    expect(screen.getByText(/平台管理员（系统唯一）/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: '结束试用'}),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('到期后将归档的数据')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: '立即导出一份'}),
    ).toBeInTheDocument();
  });

  async function openClear() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: '清空工作区'}));
    const dialog = await screen.findByRole('dialog', {name: '确认清空工作区'});
    return {user, dialog};
  }
  const clearCalls = () =>
    businessDb.requests.filter(r => r.path === '/workspace/clear');

  it('clears the admin workspace', async () => {
    renderApp('/account', {as: 'admin', me: adminMe()});
    const {user, dialog} = await openClear();
    expect(dialog).toHaveTextContent(`将清空工作区 ${shortTid(ADMIN_TID)}。`);
    await user.click(within(dialog).getByRole('button', {name: '确认清空'}));
    await waitFor(() => expect(clearCalls()).toHaveLength(1));
    expect(clearCalls()[0].headers['x-act-as-tenant']).toBeUndefined();
  });

  it('names and clears the target workspace in the admin view', async () => {
    const target = 'ws-01J9AAAAAAAAAAAAAAAAAAAK4';
    renderApp('/account', {as: 'admin', me: adminMe()});
    useSession.getState().setActAs({tenantId: target, email: 'a@example.com'});
    const {user, dialog} = await openClear();
    expect(dialog).toHaveTextContent(
      `将清空目标工作区 ${shortTid(target)}（a@example.com）`,
    );
    await user.click(within(dialog).getByRole('button', {name: '确认清空'}));
    await waitFor(() => expect(clearCalls()).toHaveLength(1));
    expect(clearCalls()[0].headers['x-act-as-tenant']).toBe(target);
  });
});
