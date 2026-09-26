/**
 * @fileoverview Object pages: type cards, table rows from the server, sort /
 * filter synced to the URL, search replacing rows, saving an Object Set and
 * the unknown-type empty state.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {viewerUser} from '../../test/fixtures';
import {db} from '../../test/handlers';
import {renderApp} from '../../test/render';
import {server} from '../../test/server';

const rowTitles = () =>
  screen
    .getAllByRole('row')
    .filter(r => r.hasAttribute('data-rid'))
    .map(r => within(r).getAllByRole('cell')[0].textContent);

describe('ObjectsIndexPage', () => {
  it('lists the object types as cards', async () => {
    renderApp('/objects', {user: viewerUser});
    const card = await screen.findByRole('link', {name: /供应商/});
    expect(card).toHaveAttribute('href', '/objects/Supplier');
    expect(within(card).getByText('属性').nextSibling).toHaveTextContent('8');
    expect(screen.getByRole('link', {name: /物料/})).toBeInTheDocument();
  });

  it('shows an empty state before an ontology is published', async () => {
    server.use(
      http.get('*/api/v1/ontology/model', () =>
        HttpResponse.json({code: 'NOT_FOUND', status: 404}, {status: 404}),
      ),
    );
    renderApp('/objects');
    expect(await screen.findByText('尚未发布本体')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '前往本体工作台'})).toHaveAttribute(
      'href',
      '/ontology',
    );
  });
});

describe('ObjectListPage', () => {
  it('loads rows and sorts via the URL', async () => {
    const {router} = renderApp('/objects/Supplier', {user: viewerUser});
    await screen.findByRole('table', {name: '供应商列表'});
    await waitFor(() => expect(rowTitles()).toHaveLength(4));
    expect(screen.getByText('共 4 条')).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', {name: '按风险分排序'}));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        sort: 'riskScore:asc',
      }),
    );
    await waitFor(() => expect(rowTitles()[0]).toBe('Penang Semicon'));
  });

  it('applies the filter builder to the URL', async () => {
    const {router} = renderApp('/objects/Supplier', {user: viewerUser});
    const user = userEvent.setup();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', {name: '过滤'}));
    await user.click(await screen.findByRole('button', {name: '添加条件'}));
    const row = screen.getByRole('group', {name: '条件 1'});
    await user.selectOptions(
      within(row).getByRole('combobox', {name: '属性'}),
      'country',
    );
    await user.type(within(row).getByRole('textbox', {name: '值'}), 'VN');
    await user.click(screen.getByRole('button', {name: '应用'}));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        filter: JSON.stringify({op: 'eq', prop: 'country', value: 'VN'}),
      }),
    );
    await waitFor(() => expect(rowTitles()).toEqual(['Hanoi Circuit Works']));
    expect(
      screen.getByRole('button', {name: '过滤（1 个条件）'}),
    ).toBeInTheDocument();
  });

  it('replaces rows with search results', async () => {
    renderApp('/objects/Supplier?q=penang', {user: viewerUser});
    await waitFor(() => expect(rowTitles()).toEqual(['Penang Semicon']));
    expect(screen.getByText('搜索：penang')).toBeInTheDocument();
  });

  it('saves the current view as an object set', async () => {
    // The router serializes JSON-looking strings as JSON string literals.
    const filter = JSON.stringify(
      JSON.stringify({op: 'eq', prop: 'status', value: 'active'}),
    );
    const {router} = renderApp(
      `/objects/Supplier?filter=${encodeURIComponent(filter)}`,
    );
    const user = userEvent.setup();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', {name: '保存为对象集'}));
    const dialog = await screen.findByRole('dialog', {name: '保存为对象集'});
    await user.type(within(dialog).getByLabelText(/名称/), '活跃供应商');
    await user.click(within(dialog).getByRole('button', {name: '保存'}));
    await waitFor(() => expect(db.objectSets).toHaveLength(1));
    expect(db.objectSets[0]).toMatchObject({
      name: '活跃供应商',
      definition: {
        objectType: 'Supplier',
        filter: {op: 'eq', prop: 'status', value: 'active'},
      },
    });
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({set: 'os-1'}),
    );
  });

  it('shows an empty state for unknown types', async () => {
    renderApp('/objects/Nope', {user: viewerUser});
    expect(
      await screen.findByText('未知的对象类型「Nope」'),
    ).toBeInTheDocument();
  });
});
