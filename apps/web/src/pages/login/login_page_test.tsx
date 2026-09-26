/**
 * @fileoverview Login flow: validation, wrong password, success returns to
 * the `redirect` route, language switch.
 */

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it} from 'vitest';
import {useSession} from '../../entities/session/store';
import {i18n} from '../../shared/lib/i18n';
import {db} from '../../test/handlers';
import {renderApp} from '../../test/render';
import {safeRedirect} from './login_page';

describe('LoginPage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('validates inputs before submitting', async () => {
    db.refreshOk = false;
    renderApp('/login', {user: null});
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: '登录'}));
    expect(await screen.findByText('请输入有效的邮箱地址')).toBeInTheDocument();
    expect(screen.getByText('请输入密码')).toBeInTheDocument();
  });

  it('shows the localized AUTH_INVALID message', async () => {
    db.refreshOk = false;
    renderApp('/login', {user: null});
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/邮箱/), 'admin@example.com');
    await user.type(screen.getByLabelText(/密码/), 'wrong');
    await user.click(screen.getByRole('button', {name: '登录'}));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '邮箱或密码错误',
    );
  });

  it('signs in and returns to the redirect route', async () => {
    db.refreshOk = false;
    const {router} = renderApp('/login?redirect=%2Fcockpit%3Fmode%3Dwall', {
      user: null,
    });
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText(/邮箱/),
      'operator@example.com',
    );
    await user.type(screen.getByLabelText(/密码/), 'Passw0rd!!');
    await user.click(screen.getByRole('button', {name: '登录'}));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/cockpit'),
    );
    expect(useSession.getState().user?.role).toBe('Operator');
    expect(useSession.getState().accessToken).toMatch(/^token-/);
  });

  it('redirects unauthenticated users to /login with the original route', async () => {
    db.refreshOk = false;
    const {router} = renderApp('/recommendations', {user: null});
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(
      (router.state.location.search as {redirect?: string}).redirect,
    ).toContain('/recommendations');
  });

  it('switches language without reloading', async () => {
    db.refreshOk = false;
    renderApp('/login', {user: null});
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: 'EN'}));
    expect(
      await screen.findByRole('button', {name: 'Sign in'}),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('only accepts same-origin redirects', () => {
    expect(safeRedirect('https://evil.example/x')).toBe('/cockpit');
    expect(safeRedirect('//evil.example')).toBe('/cockpit');
    expect(safeRedirect('/objects/Supplier?q=1')).toBe('/objects/Supplier?q=1');
    expect(safeRedirect(undefined)).toBe('/cockpit');
  });
});
