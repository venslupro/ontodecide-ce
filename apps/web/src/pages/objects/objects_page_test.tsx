/**
 * @fileoverview Objects page: type tabs with counts from /objects/stats,
 * ontology-driven table, debounced search, sort on indexed columns and the
 * filter builder producing a FilterExpr in `GET /objects?filter=`.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {API} from '../../test/handlers/problem';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {ObjectsPage} from './objects_page';

function captureObjectQueries(): URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({request}) => {
    const u = new URL(request.url);
    if (u.pathname === '/api/v1/objects') seen.push(u.searchParams);
  });
  return seen;
}

describe('ObjectsPage', () => {
  it('lists the first type with ontology columns and counts', async () => {
    renderWithProviders(<ObjectsPage />, {url: '/objects'});
    expect(await screen.findByText('苏州精密零件有限公司')).toBeInTheDocument();
    const tab = screen.getByRole('tab', {name: /供应商/});
    expect(tab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(tab).toHaveTextContent('8'));
    expect(
      screen.getByRole('columnheader', {name: '名称'}),
    ).toBeInTheDocument();
  });

  it('switches type from the tab bar', async () => {
    const {router} = renderWithProviders(<ObjectsPage />, {url: '/objects'});
    await userEvent.click(await screen.findByRole('tab', {name: /物料/}));
    expect(await screen.findByText('M-2231')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({type: 'Material'});
  });

  it('searches with debounce and sorts by an indexed column', async () => {
    const seen = captureObjectQueries();
    renderWithProviders(<ObjectsPage />, {url: '/objects?type=Supplier'});
    await screen.findByText('宁波恒达机电');
    await userEvent.type(
      screen.getByRole('textbox', {name: '搜索对象'}),
      '宁波',
    );
    await waitFor(() =>
      expect(seen.some(s => s.get('q') === '宁波')).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByText('苏州精密零件有限公司')).toBeNull(),
    );
    await userEvent.click(screen.getByRole('button', {name: '按 风险分 排序'}));
    await waitFor(() =>
      expect(seen.some(s => s.get('orderBy') === 'riskScore:asc')).toBe(true),
    );
    server.events.removeAllListeners();
  });

  it('applies a filter from the builder', async () => {
    const seen = captureObjectQueries();
    renderWithProviders(<ObjectsPage />, {url: '/objects?type=Supplier'});
    await screen.findByText('宁波恒达机电');
    await userEvent.click(screen.getByRole('button', {name: '过滤'}));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', {name: '添加条件'}),
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', {name: '属性'}),
      'riskScore',
    );
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', {name: '算子'}),
      'gt',
    );
    await userEvent.type(
      within(dialog).getByRole('spinbutton', {name: '值'}),
      '60',
    );
    await userEvent.click(within(dialog).getByRole('button', {name: '应用'}));
    await waitFor(() =>
      expect(
        seen.some(
          s =>
            s.get('filter') ===
            JSON.stringify({op: 'gt', prop: 'riskScore', value: 60}),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('苏州精密零件有限公司')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('宁波恒达机电')).toBeNull());
    server.events.removeAllListeners();
  });

  it('shows an empty state with the import CTA', async () => {
    server.use(
      http.get(`${API}/objects`, () =>
        HttpResponse.json({items: [], nextCursor: null}),
      ),
    );
    renderWithProviders(<ObjectsPage />, {url: '/objects?type=Plant'});
    expect(await screen.findByText('该类型还没有对象')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: '导入文件'})).toBeInTheDocument();
  });
});
