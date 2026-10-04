/**
 * @fileoverview /login: owner code login with `next`; admin passkey
 * assertion; first admin login (setup code → passkey #1 → forced passkey
 * #2 with step-up → 10 recovery codes once); recovery code; no WebAuthn.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it} from 'vitest';
import {useSession} from '../../entities/session/store';
import {
  ADMIN_EMAIL,
  platformDb,
  recorded,
  SETUP_CODE,
  TEST_CODE,
} from '../../test/handlers/platform';
import {renderWithProviders} from '../../test/render';
import {installWebAuthn, removeWebAuthn} from '../../test/webauthn_mock';
import {LoginPage, safeNext} from './login_page';

afterEach(() => removeWebAuthn());

async function login(email: string, url = '/login') {
  const user = userEvent.setup();
  const r = renderWithProviders(<LoginPage />, {as: 'anonymous', url});
  await user.type(await screen.findByLabelText('邮箱'), email);
  await screen.findByText('人机验证已通过');
  await user.click(screen.getByRole('button', {name: '发送验证码'}));
  const boxes = await screen.findAllByLabelText(/^第 \d 位$/);
  await user.click(boxes[0]);
  await user.keyboard(TEST_CODE);
  return {user, ...r};
}

describe('safeNext', () => {
  it('only accepts app paths', () => {
    expect(safeNext('/objects?q=1', '/c')).toBe('/objects?q=1');
    expect(safeNext('//evil.com', '/c')).toBe('/c');
    expect(safeNext('https://evil.com', '/c')).toBe('/c');
    expect(safeNext('/login', '/c')).toBe('/c');
    expect(safeNext(undefined, '/c')).toBe('/c');
  });
});

describe('LoginPage', () => {
  it('greets first-time visitors neutrally and offers sign-up', async () => {
    const {router} = renderWithProviders(<LoginPage />, {
      as: 'anonymous',
      url: '/login',
    });
    expect(await screen.findByText('用邮箱登录')).toBeInTheDocument();
    expect(screen.queryByText('欢迎回来')).not.toBeInTheDocument();
    // Display switches live in the page header, not in the form card.
    const card = screen.getByRole('heading', {name: '登录'}).closest('section');
    expect(
      within(card!).queryByRole('radiogroup', {name: '界面语言'}),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).getByRole('radiogroup', {
        name: '界面语言',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).queryByRole('radiogroup', {
        name: '主题',
      }),
    ).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', {name: '注册免费试用账户'}));
    await waitFor(() => expect(router.state.location.pathname).toBe('/signup'));
  });

  it('signs an owner in and returns to next', async () => {
    const {router} = await login(
      'wang.yun@example.com',
      '/login?next=%2Faccount',
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/account'),
    );
    expect(recorded('POST', '/auth/codes')[0].body).toMatchObject({
      purpose: 'login',
    });
  });

  it('requires a passkey for the admin (daily login)', async () => {
    const {get} = installWebAuthn();
    const {router} = await login(ADMIN_EMAIL);
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    expect(get).toHaveBeenCalledTimes(1);
    expect(recorded('POST', '/auth/passkeys/options')[0].body).toEqual({
      purpose: 'login',
      preAuth: 'pre-1',
    });
    expect(useSession.getState().role).toBe('admin');
    expect(useSession.getState().adminSessionEndsAt).toBeGreaterThan(
      Date.now(),
    );
  });

  it('stays on the passkey step when the passkey is cancelled', async () => {
    installWebAuthn({failGet: true});
    const {router} = await login(ADMIN_EMAIL);
    expect(
      await screen.findByText('Passkey 验证失败或已取消，请重试'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(useSession.getState().status).not.toBe('authenticated');
  });

  it('runs the first-login setup: setup code, two passkeys, recovery codes once', async () => {
    platformDb.setupRequired = true;
    platformDb.adminPasskeys = 0;
    const {create, get} = installWebAuthn();
    const {user, router} = await login(ADMIN_EMAIL);
    const input = await screen.findByLabelText('输入运维提供的初始化码');
    await user.type(input, 'WRONG-CODE-0');
    await user.click(screen.getByRole('button', {name: '绑定第一个 Passkey'}));
    expect(
      await screen.findByText('初始化码错误或已使用，请联系运维'),
    ).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, SETUP_CODE);
    await user.click(screen.getByRole('button', {name: '绑定第一个 Passkey'}));
    await user.click(
      await screen.findByRole('button', {name: '绑定第二个 Passkey'}),
    );
    expect(await screen.findByLabelText('恢复码')).toBeInTheDocument();
    expect(screen.getAllByText(/^RC-\d{4}-ABCD$/)).toHaveLength(10);
    expect(create).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(1); // step-up with passkey #1
    const add = recorded('POST', '/admin/passkeys').filter(
      r => r.path === '/admin/passkeys',
    );
    expect(add[0].headers['x-step-up']).toBe('su-1');
    const go = screen.getByRole('button', {name: '进入平台管理'});
    expect(go).toBeDisabled();
    await user.click(screen.getByLabelText('我已保存这些恢复码'));
    await user.click(go);
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('sends an admin with one passkey back to the second-passkey step', async () => {
    platformDb.adminPasskeys = 1;
    installWebAuthn();
    await login(ADMIN_EMAIL);
    expect(
      await screen.findByRole('button', {name: '绑定第二个 Passkey'}),
    ).toBeInTheDocument();
  });

  it('accepts a recovery code instead of a passkey', async () => {
    installWebAuthn({failGet: true});
    const {user, router} = await login(ADMIN_EMAIL);
    await user.click(
      await screen.findByRole('button', {name: 'Passkey 丢失？使用恢复码'}),
    );
    await user.type(screen.getByLabelText('恢复码'), 'RECOVERY-0001');
    await user.click(screen.getByRole('button', {name: '使用恢复码登录'}));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });

  it('explains when the browser has no WebAuthn', async () => {
    removeWebAuthn();
    await login(ADMIN_EMAIL);
    expect(
      await screen.findByText('当前浏览器不支持 Passkey'),
    ).toBeInTheDocument();
  });
});
