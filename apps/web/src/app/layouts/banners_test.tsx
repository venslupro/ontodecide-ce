/**
 * @fileoverview Expiry banner (≤ 24 h, owner only) and quota bars.
 */

import {act, screen, waitFor} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {QuotaBars} from '../../entities/quota';
import {adminMe, ownerMe} from '../../test/fixtures/platform';
import {renderWithProviders} from '../../test/render';
import {useSession} from '../../entities/session/store';
import {AdminSessionStrip, ExpiryBanner} from './banners';

describe('ExpiryBanner', () => {
  it('shows with ≤ 24 h left, with the time zone and export', async () => {
    renderWithProviders(<ExpiryBanner />, {me: ownerMe(5)});
    expect(
      await screen.findByText(/试用将于 .*（GMT\+8）到期/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '立即导出'})).toBeInTheDocument();
  });

  it('is hidden with more than 24 h left and for the admin', () => {
    const a = renderWithProviders(<ExpiryBanner />, {me: ownerMe(30)});
    expect(
      screen.queryByRole('button', {name: '立即导出'}),
    ).not.toBeInTheDocument();
    a.unmount();
    renderWithProviders(<ExpiryBanner />, {as: 'admin', me: adminMe()});
    expect(
      screen.queryByRole('button', {name: '立即导出'}),
    ).not.toBeInTheDocument();
  });
});

describe('QuotaBars', () => {
  it('renders used / limit from GET /me and the reset note', async () => {
    renderWithProviders(<QuotaBars />);
    expect(await screen.findByText('对象数')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
    expect(screen.getByText(/每日 0 点（UTC）重置/)).toBeInTheDocument();
  });
});

describe('AdminSessionStrip (8 h admin session)', () => {
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();

  it('warns in the last 10 minutes from me.sessionExpiresAt (survives reloads)', async () => {
    renderWithProviders(<AdminSessionStrip />, {
      as: 'admin',
      me: {...adminMe(), sessionExpiresAt: at(5 * 60_000)},
      url: '/admin',
    });
    // No local timer (as after a page reload): /me alone drives it.
    expect(useSession.getState().adminSessionEndsAt).toBeUndefined();
    expect(
      await screen.findByText(/管理员会话将在 .* 后结束/),
    ).toBeInTheDocument();
  });

  it('prefers me.sessionExpiresAt over the local timer', () => {
    renderWithProviders(<AdminSessionStrip />, {
      as: 'admin',
      me: {...adminMe(), sessionExpiresAt: at(7 * 3_600_000)},
      url: '/admin',
    });
    act(() => useSession.getState().setAdminSessionEndsAt(Date.now() + 60_000));
    expect(screen.queryByText(/管理员会话将在/)).not.toBeInTheDocument();
  });

  it('falls back to the local timer without sessionExpiresAt', async () => {
    renderWithProviders(<AdminSessionStrip />, {
      as: 'admin',
      me: adminMe(),
      url: '/admin',
    });
    act(() =>
      useSession.getState().setAdminSessionEndsAt(Date.now() + 3 * 60_000),
    );
    expect(await screen.findByText(/管理员会话将在/)).toBeInTheDocument();
  });

  it('forces a re-login when the session has ended', async () => {
    const {router} = renderWithProviders(<AdminSessionStrip />, {
      as: 'admin',
      me: {...adminMe(), sessionExpiresAt: at(-1000)},
      url: '/admin',
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(useSession.getState().status).toBe('anonymous');
  });
});
