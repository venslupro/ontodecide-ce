/**
 * @fileoverview Ontology index: schema list and built-in pack import.
 */

import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {renderApp} from '../../test/render';

describe('OntologyIndexPage', () => {
  it('lists schemas and imports the built-in pack', async () => {
    renderApp('/ontology');
    const table = await screen.findByRole('table', {name: '本体'});
    expect(within(table).getByText('供应链')).toBeInTheDocument();
    expect(within(table).getByText('v1.0.0')).toBeInTheDocument();
    const user = userEvent.setup();
    expect(await screen.findByText('内置')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {name: '导入本体包 供应链风险监测'}),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '确认导入',
      }),
    );
    const result = await screen.findByRole('dialog', {name: '导入完成'});
    expect(
      within(result).getByText('供应链风险监测 已发布为 supplyChain v1.0.0'),
    ).toBeInTheDocument();
  });

  it('validates the new ontology api name', async () => {
    renderApp('/ontology');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: '新建本体'}));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/API 名称/), '9bad');
    await user.click(within(dialog).getByRole('button', {name: '创建并打开'}));
    expect(
      await within(dialog).findByText(
        'API 名称须以字母开头，仅含字母、数字、下划线',
      ),
    ).toBeInTheDocument();
  });

  it('creates an empty ontology and opens the workbench', async () => {
    const {router} = renderApp('/ontology');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: '新建本体'}));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/API 名称/), 'riskHub');
    await user.type(
      within(dialog).getByLabelText(/显示名称 · 中文/),
      '风险中心',
    );
    await user.click(within(dialog).getByRole('button', {name: '创建并打开'}));
    expect(
      await screen.findByRole('heading', {level: 1, name: '风险中心'}),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/ontology/riskHub');
    expect(screen.getByText('有未保存的更改')).toBeInTheDocument();
    expect(screen.getByText('暂无对象类型')).toBeInTheDocument();
  });
});
