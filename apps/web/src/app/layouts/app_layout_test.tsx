/**
 * @fileoverview App shell: role-based menu, page-level "no permission",
 * quota bar thresholds, offline banner, language switch.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {i18n} from '../../shared/lib/i18n';
import {adminUser, viewerUser} from '../../test/fixtures';
import {renderApp} from '../../test/render';
import {maxUsage} from './quota_bar';

describe('AppLayout', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('zh-CN');
  });

  it('hides menu items above the user role and shows the required role on a forbidden page', async () => {
    renderApp('/admin/users', {user: viewerUser});
    expect(await screen.findByText('无权限访问')).toBeInTheDocument();
    expect(
      screen.getByText(/此页面需要「管理员」或更高角色/),
    ).toBeInTheDocument();
    const nav = screen.getByRole('complementary', {name: '主导航'});
    expect(
      within(nav).getByRole('link', {name: /态势总览/}),
    ).toBeInTheDocument();
    expect(
      within(nav).queryByRole('link', {name: /本体工作台/}),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole('link', {name: /用户与权限/}),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole('link', {name: /建议中心/}),
    ).not.toBeInTheDocument();
  });

  it('shows every menu item to admins', async () => {
    renderApp('/admin/health', {user: adminUser});
    const nav = await screen.findByRole('complementary', {name: '主导航'});
    for (const label of [
      '态势总览',
      '对象浏览',
      '关系探索',
      '情景推演',
      '建议中心',
      '自动化规则',
      '数据接入',
      '本体工作台',
      '用户与权限',
      '系统健康',
    ]) {
      expect(
        within(nav).getByRole('link', {name: new RegExp(label)}),
      ).toBeInTheDocument();
    }
  });

  it('colors the quota bar by the highest resource ratio', async () => {
    renderApp('/admin/users', {user: viewerUser});
    const btn = await screen.findByRole('button', {
      name: '免费额度最高占用 83%',
    });
    expect(btn.querySelector('.text-warn')).not.toBeNull();
    expect(maxUsage({'d1.rowsWritten': 0.96, 'kv.writes': 0.2})).toEqual({
      resource: 'd1.rowsWritten',
      ratio: 0.96,
    });
  });

  it('shows the offline banner', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp('/admin/users', {user: viewerUser});
    expect(await screen.findByText(/网络已断开/)).toBeInTheDocument();
  });

  it('switches the whole shell to English at runtime', async () => {
    renderApp('/admin/users', {user: viewerUser});
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: 'EN'}));
    await waitFor(() =>
      expect(
        screen.getByRole('complementary', {name: 'Main navigation'}),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("You don't have permission")).toBeInTheDocument();
  });
});
