/**
 * @fileoverview Route guards (表 8) through the real route tree.
 */

import {screen, waitFor} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {useSession} from '../entities/session/store';
import {adminMe, ownerMe} from '../test/fixtures/platform';
import {platformDb} from '../test/handlers/platform';
import {renderApp} from '../test/render';
import {decideApp} from './guards';

describe('decideApp', () => {
  it('maps restore outcomes', () => {
    expect(decideApp('ok', '/x', false)).toEqual({kind: 'allow'});
    expect(decideApp('ok', '/x', true)).toEqual({kind: 'ended'});
    expect(decideApp('expired', '/x', false)).toEqual({kind: 'ended'});
    expect(decideApp('unauthenticated', '/x', true)).toEqual({kind: 'ended'});
    expect(decideApp('unauthenticated', '/x', false)).toEqual({
      kind: 'login',
      next: '/x',
    });
  });
});

describe('route guards', () => {
  it('sends anonymous users to /login?next=', async () => {
    const {router} = renderApp('/account', {as: 'anonymous'});
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({next: '/account'});
  });

  it('restores a session silently from the refresh cookie', async () => {
    const {router} = renderApp('/account', {as: 'anonymous'});
    platformDb.refresh = 'ok';
    platformDb.me = ownerMe();
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/\/(account|login)/),
    );
    // The first navigation above may race; a fresh navigation restores.
    useSession.getState().signOut();
    await router.navigate({to: '/account'});
    await screen.findByRole('heading', {name: '账户与数据'});
  });

  it('goes to /ended when the refresh reports TRIAL_EXPIRED', async () => {
    const {router} = renderApp('/account', {as: 'anonymous'});
    platformDb.refresh = 'expired';
    await router.navigate({to: '/account'});
    await waitFor(() => expect(router.state.location.pathname).toBe('/ended'));
    expect(await screen.findByText('你的数据已打包')).toBeInTheDocument();
  });

  it('shows the 403 page to owners on /admin and no platform menu', async () => {
    renderApp('/admin');
    expect(await screen.findByText('无权执行该操作')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {name: '平台管理'}),
    ).not.toBeInTheDocument();
  });

  it('redirects signed-in users away from /login', async () => {
    const {router} = renderApp('/login');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/cockpit'),
    );
  });

  it('lets the admin open /admin and shows the platform group and admin card', async () => {
    renderApp('/admin', {as: 'admin', me: adminMe()});
    expect(
      await screen.findByRole('heading', {name: '平台概览'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '平台管理'})).toBeInTheDocument();
    expect(screen.getByText('不过期 · 不可删除')).toBeInTheDocument();
    expect(screen.getByText('平台管理员 Admin')).toBeInTheDocument();
  });

  it('shows the owner trial card and account chip', async () => {
    renderApp('/account');
    expect(await screen.findByText('试用剩余')).toBeInTheDocument();
    expect(screen.getByText('所有者 Owner')).toBeInTheDocument();
    expect(screen.getByText(/^1 天 0[45] 小时$/)).toBeInTheDocument();
    for (const g of ['运营', '构建', '我的'])
      expect(screen.getByText(g)).toBeInTheDocument();
  });
});
