/**
 * @fileoverview Ontology workbench page: tree, edit + save (If-Match, copy
 * on write notice), new object type (POST), validation errors, 412 conflict
 * dialog and the delete warning with the object count from /objects/stats.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import {makeObjects} from '../../test/fixtures/business';
import {businessDb} from '../../test/handlers/business';
import {API, problem} from '../../test/handlers/problem';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {OntologyPage} from './ontology_page';

// renderWithProviders does not need the app route tree; mocking it keeps
// this test independent of pages other agents are still writing.
vi.mock('../../app/router', () => ({routeTree: {}}));

async function renderPage() {
  const r = renderWithProviders(<OntologyPage />, {url: '/ontology'});
  await screen.findByRole('navigation', {name: '本体定义'});
  return r;
}

function lastRequest(method: string, path: string) {
  return [...businessDb.requests]
    .reverse()
    .find(r => r.method === method && r.path === path);
}

describe('OntologyPage', () => {
  it('renders the definition tree, the copy-on-write notice and the graph', async () => {
    await renderPage();
    const tree = screen.getByRole('navigation', {name: '本体定义'});
    const types = within(tree).getByRole('list', {name: '对象类型'});
    expect(within(types).getAllByRole('listitem')).toHaveLength(4);
    expect(
      within(types).getByRole('button', {name: /供应商\s*8 个属性/}),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      within(tree).getByRole('list', {name: '关系类型'}),
    ).toHaveTextContent('Supplier → Material');
    expect(
      within(tree).getByRole('list', {name: '动作类型'}),
    ).toHaveTextContent('切换供应商');
    expect(screen.getByTestId('copy-on-write-notice')).toHaveTextContent(
      '首次修改时将复制为你的副本',
    );
    expect(screen.getByTestId('copy-on-write-notice')).toHaveTextContent(
      '供应链风险',
    );
    expect(
      screen.getByLabelText('Schema 关系图：4 个对象类型，3 种关系'),
    ).toBeInTheDocument();
    // The selected object type's form.
    expect(screen.getAllByTestId('property-row')).toHaveLength(8);
  });

  it('edits a property display name and saves with If-Match "v0"', async () => {
    await renderPage();
    const user = userEvent.setup();
    const input = screen.getByLabelText('country 的中文名');
    await user.clear(input);
    await user.type(input, '所在国家');
    expect(screen.getByText('未保存')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: '保存'}));
    await waitFor(() =>
      expect(lastRequest('PUT', '/object-types/Supplier')).toBeDefined(),
    );
    const req = lastRequest('PUT', '/object-types/Supplier')!;
    expect(req.headers['if-match']).toBe('"v0"');
    const body = req.body as {
      properties: {apiName: string; displayName: unknown}[];
    };
    expect(
      body.properties.find(p => p.apiName === 'country')?.displayName,
    ).toEqual({
      'zh-CN': '所在国家',
      'en-US': 'Country',
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId('copy-on-write-notice'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('你的副本 · v1')).toBeInTheDocument();
    expect(businessDb.ontology.custom).toBe(true);
  });

  it('creates a new object type with POST', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', {name: '新建对象类型'}));
    await user.type(screen.getByLabelText(/^API 名称/), 'Warehouse');
    await user.type(screen.getByLabelText(/^显示名称（中文）/), '仓库');
    await user.click(screen.getByRole('button', {name: '保存'}));
    await waitFor(() =>
      expect(lastRequest('POST', '/object-types')).toBeDefined(),
    );
    const req = lastRequest('POST', '/object-types')!;
    expect(req.headers['if-match']).toBe('"v0"');
    expect(req.body).toMatchObject({
      apiName: 'Warehouse',
      displayName: {'zh-CN': '仓库'},
      primaryKey: 'id',
      titleProperty: 'id',
      properties: [
        {apiName: 'id', dataType: 'string', required: true, indexed: true},
      ],
    });
    const types = screen.getByRole('list', {name: '对象类型'});
    expect(
      await within(types).findByRole('button', {name: /仓库/}),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('shows field errors from the contract schema and does not send', async () => {
    await renderPage();
    const user = userEvent.setup();
    const api = screen.getByLabelText('属性 3 的 API 名称');
    await user.clear(api);
    await user.type(api, '3bad');
    await user.click(screen.getByRole('button', {name: '保存'}));
    expect(await screen.findByText(/API 名称须以字母开头/)).toBeInTheDocument();
    expect(lastRequest('PUT', '/object-types/Supplier')).toBeUndefined();
  });

  it('shows server VALIDATION_FAILED field errors inline', async () => {
    server.use(
      http.put(`${API}/object-types/:id`, () =>
        problem(422, 'VALIDATION_FAILED', 'bad', {
          errors: [{path: 'properties.2.unit', message: 'unit not allowed'}],
        }),
      ),
    );
    await renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('country 的单位'), 'x');
    await user.click(screen.getByRole('button', {name: '保存'}));
    expect(await screen.findByText('unit not allowed')).toBeInTheDocument();
  });

  it('opens the conflict dialog on 412 and refresh discards the edits', async () => {
    server.use(
      http.put(`${API}/object-types/:id`, () =>
        problem(412, 'PRECONDITION_FAILED'),
      ),
    );
    await renderPage();
    const user = userEvent.setup();
    const input = screen.getByLabelText('country 的中文名');
    await user.clear(input);
    await user.type(input, '别的名字');
    await user.click(screen.getByRole('button', {name: '保存'}));
    const dialog = await screen.findByRole('dialog', {
      name: '内容已在其他窗口修改',
    });
    await user.click(within(dialog).getByRole('button', {name: '查看差异'}));
    expect(
      await within(dialog).findByRole('table', {name: '查看差异'}),
    ).toHaveTextContent('properties');
    await user.click(
      within(dialog).getByRole('button', {name: '刷新并放弃我的修改'}),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('country 的中文名')).toHaveValue('国家'),
    );
    expect(screen.queryByText('未保存')).not.toBeInTheDocument();
  });

  it('warns with the object count before deleting a type, then deletes with If-Match', async () => {
    const count = makeObjects().filter(o => o.type === 'Supplier').length;
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', {name: '删除'}));
    const dialog = await screen.findByRole('dialog', {
      name: '删除「供应商」？',
    });
    expect(
      await within(dialog).findByTestId('delete-object-count'),
    ).toHaveTextContent(`该类型下有 ${count} 个对象会受影响。`);
    expect(dialog).toHaveTextContent('不允许悬空引用');
    expect(dialog).toHaveTextContent('supplies');
    await user.click(within(dialog).getByRole('button', {name: '删除'}));
    await waitFor(() =>
      expect(lastRequest('DELETE', '/object-types/Supplier')).toBeDefined(),
    );
    expect(
      lastRequest('DELETE', '/object-types/Supplier')!.headers['if-match'],
    ).toBe('"v0"');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('list', {name: '对象类型'})).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(3);
  });

  it('edits a link type (propagation weight) and an action type', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', {name: /供应\s*Supplier → Material/}),
    );
    const w = screen.getByLabelText(/^默认权重/);
    await user.clear(w);
    await user.type(w, '0.5');
    await user.click(screen.getByRole('button', {name: '保存'}));
    await waitFor(() =>
      expect(lastRequest('PUT', '/link-types/supplies')).toBeDefined(),
    );
    expect(lastRequest('PUT', '/link-types/supplies')!.body).toMatchObject({
      propagation: {defaultWeight: 0.5},
    });

    await user.click(screen.getByRole('button', {name: /调整安全库存/}));
    await user.click(screen.getByRole('button', {name: '添加影响提示'}));
    await user.selectOptions(
      screen.getByLabelText('影响提示 1 的属性'),
      'daysOfSupply',
    );
    const c = screen.getByLabelText('影响提示 1 的相对变化');
    await user.clear(c);
    await user.type(c, '0.2');
    await user.click(screen.getByRole('button', {name: '保存'}));
    await waitFor(() =>
      expect(
        lastRequest('PUT', '/action-types/adjustSafetyStock'),
      ).toBeDefined(),
    );
    const req = lastRequest('PUT', '/action-types/adjustSafetyStock')!;
    expect(req.headers['if-match']).toBe('"v1"');
    expect(req.body).toMatchObject({
      impact: [{property: 'daysOfSupply', change: 0.2}],
      effects: [
        {kind: 'increment', prop: 'safetyStock', by: {var: 'params.delta'}},
      ],
    });
  });
});
