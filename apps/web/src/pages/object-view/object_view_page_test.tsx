/**
 * @fileoverview Object View: title / RID / risk, properties with source,
 * role-gated action menu, property deep links and the 404 empty state.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {operatorUser, suppliers, viewerUser} from '../../test/fixtures';
import {renderApp} from '../../test/render';

const s002 = suppliers[1];
const url = `/objects/rid/${s002.rid}`;

describe('ObjectViewPage', () => {
  it('renders the title area, RID and properties with their source', async () => {
    renderApp(url, {user: viewerUser});
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Hanoi Circuit Works',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(s002.rid)).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    // riskScore 78 ≥ 70 → critical status badge with text.
    expect(screen.getByText(/风险分 78 · 高风险/)).toBeInTheDocument();

    const table = screen.getByRole('table', {name: '属性'});
    const row = within(table).getByRole('row', {name: /国家/});
    expect(row).toHaveAttribute('id', 'prop-country');
    expect(within(row).getByText('VN')).toBeInTheDocument();
    expect(within(row).getByText('src-suppliers')).toBeInTheDocument();
    expect(within(row).getByText(/置信度 95%/)).toBeInTheDocument();
    // The viewer lacks the PII marking.
    const email = within(table).getByRole('row', {name: /联系邮箱/});
    expect(within(email).getByText('无访问权限')).toBeInTheDocument();
    expect(screen.queryByText('sales@hcw.example')).not.toBeInTheDocument();
  });

  it('hides the action menu for Viewers', async () => {
    renderApp(url, {user: viewerUser});
    await screen.findByRole('heading', {level: 1, name: 'Hanoi Circuit Works'});
    expect(
      screen.queryByRole('button', {name: /执行动作/}),
    ).not.toBeInTheDocument();
  });

  it("lists only the type's actions for Operators", async () => {
    renderApp(url, {user: operatorUser});
    const trigger = await screen.findByRole('button', {name: /执行动作/});
    await userEvent.setup().click(trigger);
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByRole('menuitem', {name: /标记观察/}),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', {name: /切换供应商/}),
    ).not.toBeInTheDocument();
  });

  it('opens the lineage of a deep-linked property', async () => {
    renderApp(`${url}#prop-riskScore`, {user: viewerUser});
    const lineage = await screen.findByTestId('lineage-riskScore');
    expect(await within(lineage).findByText('src-legacy')).toBeInTheDocument();
    await waitFor(() =>
      expect(document.getElementById('prop-riskScore')).toHaveAttribute(
        'data-highlighted',
        'true',
      ),
    );
  });

  it('shows an empty state for unknown objects', async () => {
    renderApp('/objects/rid/ri.t1.Supplier.NOPE', {user: viewerUser});
    expect(await screen.findByText('对象不存在或已被删除')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /返回对象类型/})).toHaveAttribute(
      'href',
      '/objects',
    );
  });
});
