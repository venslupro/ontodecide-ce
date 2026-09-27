/**
 * @fileoverview Expiry banner (≤ 24 h, owner only) and quota bars.
 */

import {screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {QuotaBars} from '../../entities/quota';
import {adminMe, ownerMe} from '../../test/fixtures/platform';
import {renderWithProviders} from '../../test/render';
import {ExpiryBanner} from './banners';

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
