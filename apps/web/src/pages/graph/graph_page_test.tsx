/**
 * @fileoverview Graph explorer: prompt without a start object, depth and
 * link-type filters in `GET /objects/{rid}/links`, node details and
 * recentring.
 */

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {M2231, S017} from '../../test/fixtures/business';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {GraphPage} from './graph_page';

function captureLinks(): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({request}) => {
    const u = new URL(request.url);
    if (u.pathname.endsWith('/links')) seen.push(u);
  });
  return seen;
}

describe('GraphPage', () => {
  it('asks for a start object', async () => {
    renderWithProviders(<GraphPage />, {url: '/graph'});
    expect(
      await screen.findByText('选择一个起点对象开始探索'),
    ).toBeInTheDocument();
  });

  it('loads 2 hops by default, then 1 hop and a link-type filter', async () => {
    const seen = captureLinks();
    renderWithProviders(<GraphPage />, {url: `/graph?rid=${S017}`});
    expect(
      await screen.findByText(/2 跳 · 5 个对象 · 4 条关系/),
    ).toBeInTheDocument();
    expect(seen[0].searchParams.get('depth')).toBe('2');
    await userEvent.click(screen.getByRole('tab', {name: '1 跳'}));
    await waitFor(() =>
      expect(seen.some(u => u.searchParams.get('depth') === '1')).toBe(true),
    );
    await userEvent.click(screen.getByRole('checkbox', {name: /供应/}));
    await waitFor(() =>
      expect(
        seen.some(u => u.searchParams.get('linkTypes') === 'supplies'),
      ).toBe(true),
    );
    // screen-reader node list
    expect(screen.getAllByText(/M-2231/).length).toBeGreaterThan(0);
    server.events.removeAllListeners();
  });

  it('shows the start node and recentres from the search param', async () => {
    const {router} = renderWithProviders(<GraphPage />, {
      url: `/graph?rid=${M2231}`,
    });
    expect(
      await screen.findByRole('button', {name: '打开详情'}),
    ).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({rid: M2231});
  });
});
