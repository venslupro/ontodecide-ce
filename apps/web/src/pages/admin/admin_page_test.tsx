/**
 * @fileoverview /admin: overview, 80% amber quota, admin view enter/exit
 * with cache isolation and X-Act-As-Tenant, management actions with
 * passkey step-up + Idempotency-Key (+ If-Match for settings), archive
 * download by top-level navigation.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ActAsBanner} from '../../app/layouts/banners';
import {useSession} from '../../entities/session/store';
import {api} from '../../shared/api/client';
import {adminMe} from '../../test/fixtures/platform';
import {recorded} from '../../test/handlers/platform';
import {renderWithProviders} from '../../test/render';
import {installWebAuthn, removeWebAuthn} from '../../test/webauthn_mock';
import {AdminPage} from './admin_page';
import {parseDomains} from './admin_tools';

afterEach(() => removeWebAuthn());

function renderAdmin() {
  return renderWithProviders(
    <>
      <ActAsBanner />
      <AdminPage />
    </>,
    {as: 'admin', me: adminMe(), url: '/admin'},
  );
}

async function openManage(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  item: string,
) {
  await user.click(await screen.findByRole('button', {name: `管理 ${email}`}));
  await user.click(await screen.findByRole('menuitem', {name: item}));
}

describe('parseDomains', () => {
  it('normalizes, de-duplicates and reports invalid lines', () => {
    expect(parseDomains('Mailinator.com\nfoo.io, foo.io\nbad')).toEqual({
      domains: ['foo.io', 'mailinator.com'],
      invalid: ['bad'],
    });
  });
});

describe('AdminPage', () => {
  it('shows KPIs, free quotas with the 80% warning, users incl. ARCHIVE_ONLY', async () => {
    renderAdmin();
    expect(await screen.findByText('43')).toBeInTheDocument();
    expect(screen.getByText('活跃试用工作区')).toBeInTheDocument();
    expect(await screen.findByText('邮件 · Resend')).toBeInTheDocument();
    expect(screen.getAllByText('已超 80%')).toHaveLength(1);
    expect(screen.getByText(/硬上限 8,000/)).toBeInTheDocument();
    expect(await screen.findByText('wang.yun@example.com')).toBeInTheDocument();
    expect(screen.getByText('（账户已删除）')).toBeInTheDocument();
    expect(screen.getByText('● ARCHIVE_ONLY')).toBeInTheDocument();
    expect(screen.getByText(/ZIP 6 天后删除/)).toBeInTheDocument();
    expect(await screen.findByText(/开放中/)).toBeInTheDocument();
    for (const r of recorded('GET', '/admin/'))
      expect(r.headers['x-act-as-tenant']).toBeUndefined();
  });

  it('enters the admin view: sets act-as, clears business caches, sends the header; exit clears again', async () => {
    const user = userEvent.setup();
    const {queryClient, router} = renderAdmin();
    queryClient.setQueryData(['object', 'list', 'Supplier', {}], {items: [1]});
    queryClient.setQueryData(['situation', 'overview'], {kpis: []});
    const row = (await screen.findByText('li.na@corp.cn')).closest('tr')!;
    await user.click(within(row).getByRole('button', {name: '进入'}));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/cockpit'),
    );
    expect(useSession.getState().actAs).toEqual({
      tenantId: 'ws-01J9AAAAAAAAAAAAAAAAAAA7Q',
      email: 'li.na@corp.cn',
    });
    expect(
      queryClient.getQueryData(['object', 'list', 'Supplier', {}]),
    ).toBeUndefined();
    expect(queryClient.getQueryData(['situation', 'overview'])).toBeUndefined();
    expect(
      await screen.findByText(
        /管理员视图：正在查看 ws-01J9A…7Q（li.na@corp.cn）/,
      ),
    ).toBeInTheDocument();
    let seen: string | null = null;
    const {server} = await import('../../test/server');
    const {http, HttpResponse} = await import('msw');
    server.use(
      http.get('*/api/v1/probe', ({request}) => {
        seen = request.headers.get('x-act-as-tenant');
        return HttpResponse.json({});
      }),
    );
    await api.get('/probe');
    expect(seen).toBe('ws-01J9AAAAAAAAAAAAAAAAAAA7Q');
    queryClient.setQueryData(['decision', 'recs', {}], []);
    await user.click(screen.getByRole('button', {name: '退出'}));
    expect(useSession.getState().actAs).toBeUndefined();
    expect(queryClient.getQueryData(['decision', 'recs', {}])).toBeUndefined();
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('extends a trial with passkey step-up and an Idempotency-Key, showing the impact', async () => {
    const {get} = installWebAuthn();
    const user = userEvent.setup();
    renderAdmin();
    await openManage(user, 'wang.yun@example.com', '延长 / 缩短试用');
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('ws-01J9AAAAAAAAAAAAAAAAAAAK4'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', {name: '+24 h'}));
    expect(
      within(dialog).getByText(/到期时间延后 24 小时/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/当前 43 \/ 60/)).toBeInTheDocument();
    const save = within(dialog).getByRole('button', {name: '验证并保存'});
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/原因/), 'support request');
    await user.click(save);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(get).toHaveBeenCalledTimes(1);
    const [patch] = recorded('PATCH', '/admin/users/u1');
    expect(patch.headers['x-step-up']).toBe('su-1');
    expect(patch.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(patch.body).toMatchObject({reason: 'support request'});
    expect(typeof (patch.body as {trialExpiresAt: string}).trialExpiresAt).toBe(
      'string',
    );
  });

  it('keeps the dialog when the passkey is cancelled', async () => {
    installWebAuthn({failGet: true});
    const user = userEvent.setup();
    renderAdmin();
    await openManage(user, 'wang.yun@example.com', '删除账户');
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByLabelText('删除前归档并发送下载链接邮件'),
    );
    expect(
      within(dialog).getByText(/不归档：业务数据与账户立即删除/),
    ).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/原因/), 'spam');
    await user.click(within(dialog).getByRole('button', {name: '验证并删除'}));
    expect(
      await within(dialog).findByText('Passkey 验证失败或已取消，请重试'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/原因/)).toHaveValue('spam');
    expect(recorded('DELETE', '/admin/users/')).toHaveLength(0);
  });

  it('deletes without archive only with a reason, sending archive=false', async () => {
    installWebAuthn();
    const user = userEvent.setup();
    renderAdmin();
    await openManage(user, 'wang.yun@example.com', '删除账户');
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByLabelText('删除前归档并发送下载链接邮件'),
    );
    const del = within(dialog).getByRole('button', {name: '验证并删除'});
    expect(del).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/原因/), 'spam');
    await user.click(del);
    await waitFor(() =>
      expect(recorded('DELETE', '/admin/users/u1')).toHaveLength(1),
    );
    const [req] = recorded('DELETE', '/admin/users/u1');
    expect(req.path).toBe('/admin/users/u1?archive=false');
    expect(req.body).toEqual({reason: 'spam'});
    expect(req.headers['x-step-up']).toBe('su-1');
  });

  it('deletes with archive (default) without a reason', async () => {
    installWebAuthn();
    const user = userEvent.setup();
    renderAdmin();
    await openManage(user, 'wang.yun@example.com', '删除账户');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('可选，写入审计日志')).toBeInTheDocument();
    const del = within(dialog).getByRole('button', {name: '验证并删除'});
    expect(del).toBeEnabled();
    await user.click(del);
    await waitFor(() =>
      expect(recorded('DELETE', '/admin/users/u1')).toHaveLength(1),
    );
    const [req] = recorded('DELETE', '/admin/users/u1');
    expect(req.path).toBe('/admin/users/u1?archive=true');
    expect(req.body).toBeUndefined();
    expect(req.headers['x-step-up']).toBe('su-1');
  });

  it('shows objects / links per workspace (— for ARCHIVE_ONLY)', async () => {
    renderAdmin();
    const row = (await screen.findByText('wang.yun@example.com')).closest(
      'tr',
    )!;
    expect(within(row).getByText('212 / 540')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', {name: '对象 / 关系'}),
    ).toBeInTheDocument();
    const gone = screen.getByText('（账户已删除）').closest('tr')!;
    expect(within(gone).getByText('—')).toBeInTheDocument();
  });

  it('ARCHIVE_ONLY rows have a manage menu: download ZIP and delete archive', async () => {
    installWebAuthn();
    const user = userEvent.setup();
    renderAdmin();
    await user.click(
      await screen.findByRole('button', {
        name: '管理 ws-01J8AAAAAAAAAAAAAAAAAAA2M',
      }),
    );
    expect(
      await screen.findByRole('menuitem', {name: '下载 ZIP'}),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', {name: '删除归档'}));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', {name: '删除归档'}));
    await waitFor(() =>
      expect(
        recorded('DELETE', '/admin/archives/ws-01J8AAAAAAAAAAAAAAAAAAA2M'),
      ).toHaveLength(1),
    );
    expect(recorded('DELETE', '/admin/archives/')[0].headers['x-step-up']).toBe(
      'su-1',
    );
  });

  it('opens the account details (GET /admin/users/{uid})', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await openManage(user, 'wang.yun@example.com', '账户详情');
    const dialog = await screen.findByRole('dialog', {name: '账户详情'});
    expect(
      await within(dialog).findByText('Asia/Shanghai'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('wang.yun@example.com'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('212 / 540')).toBeInTheDocument();
    expect(within(dialog).getByText('未到期')).toBeInTheDocument();
    expect(recorded('GET', '/admin/users/u1')).toHaveLength(1);
    expect(
      recorded('GET', '/admin/users/u1')[0].headers['x-act-as-tenant'],
    ).toBeUndefined();
  });

  it('shows operational warning chips from the overview', async () => {
    const {server} = await import('../../test/server');
    const {http, HttpResponse} = await import('msw');
    const {overview} = await import('../../test/fixtures/platform');
    server.use(
      http.get('*/api/v1/admin/overview', () =>
        HttpResponse.json({
          ...overview(),
          analyticsConfigured: false,
          stuckArchives: 2,
          signKeyRotationDue: true,
        }),
      ),
    );
    renderAdmin();
    const list = await screen.findByRole('list', {name: '运维提醒'});
    expect(within(list).getByText(/未配置账户分析/)).toBeInTheDocument();
    expect(
      within(list).getByText(/2 个归档卡住超过 24 小时/),
    ).toBeInTheDocument();
    expect(within(list).getByText(/B2 签名密钥需要轮换/)).toBeInTheDocument();
  });

  it('revokes sessions with an Idempotency-Key and no step-up', async () => {
    const {get} = installWebAuthn();
    const user = userEvent.setup();
    renderAdmin();
    await openManage(user, 'li.na@corp.cn', '吊销会话');
    await user.click(await screen.findByRole('button', {name: '吊销会话'}));
    await waitFor(() =>
      expect(recorded('DELETE', '/admin/users/u2/sessions')).toHaveLength(1),
    );
    expect(
      recorded('DELETE', '/admin/users/u2/sessions')[0].headers[
        'idempotency-key'
      ],
    ).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('pauses sign-ups with If-Match and step-up', async () => {
    installWebAuthn();
    const user = userEvent.setup();
    renderAdmin();
    await user.click(await screen.findByRole('button', {name: '暂停注册'}));
    await user.click(await screen.findByRole('button', {name: '验证并保存'}));
    await waitFor(() =>
      expect(recorded('PATCH', '/admin/settings')).toHaveLength(1),
    );
    const [p] = recorded('PATCH', '/admin/settings');
    expect(p.body).toEqual({signupEnabled: false});
    expect(p.headers['if-match']).toBe('"v3"');
    expect(p.headers['x-step-up']).toBe('su-1');
    expect(p.headers['content-type']).toBe('application/merge-patch+json');
  });

  it('opens a 15-minute archive link by top-level navigation', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const user = userEvent.setup();
    renderAdmin();
    const row = (await screen.findByText('（账户已删除）')).closest('tr')!;
    await user.click(within(row).getByRole('button', {name: '下载 ZIP'}));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.href).toContain('backblazeb2.com');
    expect(
      recorded('POST', '/admin/archives/')[0].headers['idempotency-key'],
    ).toBeTruthy();
    click.mockRestore();
  });

  it('shows the audit log with the hash chain status', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(
      await screen.findByRole('button', {name: '管理员操作日志'}),
    );
    expect(await screen.findByText('哈希链校验通过')).toBeInTheDocument();
    expect(screen.getAllByText('调整试用').length).toBeGreaterThan(0);
  });
});
