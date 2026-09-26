/**
 * @fileoverview Relation explorer: empty start, search around from `?rid=`,
 * paths with degraded marker and RID chains, impact mode, mode synced to
 * the URL.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {allObjects, edges, rid, viewerUser} from '../../test/fixtures';
import {renderApp} from '../../test/render';
import {server} from '../../test/server';

const s002 = rid('Supplier', 'S002');
const p900 = rid('Product', 'P900');

describe('GraphPage', () => {
  it('asks for a start object', async () => {
    renderApp('/graph', {user: viewerUser});
    expect(
      await screen.findByText('选择一个起始对象开始探索'),
    ).toBeInTheDocument();
  });

  it('searches around the start object and syncs the mode to the URL', async () => {
    const {router} = renderApp(`/graph?rid=${s002}`, {user: viewerUser});
    // Depth 2 around S002: itself, M101, M102, then P900, P902 + S001, S003.
    expect(
      await screen.findByRole('img', {name: /关联展开关系图，共 \d+ 个节点/}),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', {name: '图例'})).toHaveTextContent(
      '供应商',
    );
    expect(screen.getByRole('checkbox', {name: '供应'})).toBeChecked();
    await userEvent.setup().click(screen.getByRole('tab', {name: /影响范围/}));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        rid: s002,
        mode: 'impact',
      }),
    );
  });

  it('lists shortest paths with titles and marks degraded results', async () => {
    renderApp(`/graph?rid=${s002}&to=${p900}&mode=paths`, {user: viewerUser});
    const path = await screen.findByRole('button', {name: /路径 1 · 2 跳/});
    await waitFor(() =>
      expect(within(path).getByText('Hanoi Circuit Works')).toBeInTheDocument(),
    );
    expect(within(path).getByText('Controller PCB')).toBeInTheDocument();
    expect(within(path).getByText('Edge Gateway X1')).toBeInTheDocument();
    expect(
      screen.getByText('图数据库不可用，路径结果可能不完整'),
    ).toBeInTheDocument();
  });

  it('shows the degraded 2-hop notice for impact', async () => {
    server.use(
      http.get('*/api/v1/graph/impact', () =>
        HttpResponse.json({
          nodes: allObjects.map(o => ({
            rid: o.rid,
            type: o.type,
            title: o.title,
            props: o.props,
            hop: o.rid === s002 ? 0 : 1,
          })),
          edges,
          degraded: true,
        }),
      ),
    );
    renderApp(`/graph?rid=${s002}&mode=impact`, {user: viewerUser});
    expect(
      await screen.findByRole('img', {name: /影响范围关系图/}),
    ).toBeInTheDocument();
    expect(
      screen.getByText('图数据库不可用，已显示 2 跳结果'),
    ).toBeInTheDocument();
  });
});
