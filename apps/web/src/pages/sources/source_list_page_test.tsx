/**
 * @fileoverview Source list: kind, target type, state (incl. paused by an
 * ontology change), last job and quality, per-source jobs, Modeler-only
 * actions and delete confirmation.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {db} from '../../test/handlers';
import {operatorUser} from '../../test/fixtures';
import {renderApp} from '../../test/render';

describe('SourceListPage', () => {
  it('lists sources with health and expandable jobs', async () => {
    db.sources.push({
      ...db.sources[0],
      id: 'src-paused',
      name: 'legacy.csv',
      paused: true,
      enabled: false,
    });
    const user = userEvent.setup();
    renderApp('/sources');
    const table = await screen.findByRole('table', {name: '数据接入'});
    const row = within(table).getByText('suppliers.csv').closest('tr')!;
    expect(within(row).getByText('文件上传')).toBeInTheDocument();
    expect(within(row).getByText('供应商')).toBeInTheDocument();
    expect(within(row).getByText('已启用')).toBeInTheDocument();
    expect(await within(row).findByText('成功')).toBeInTheDocument();
    expect(within(row).getByText('98.0%')).toBeInTheDocument();
    const paused = within(table).getByText('legacy.csv').closest('tr')!;
    expect(within(paused).getByText('本体变更已暂停')).toBeInTheDocument();

    await user.click(
      within(row).getByRole('button', {name: '展开 suppliers.csv 的作业'}),
    );
    const link = await screen.findByRole('link', {name: 'job-1'});
    expect(link).toHaveAttribute('href', '/jobs/job-1');
    expect(screen.getByRole('link', {name: /新建数据源/})).toHaveAttribute(
      'href',
      '/sources/new',
    );
  });

  it('deletes a source after confirmation', async () => {
    const user = userEvent.setup();
    renderApp('/sources');
    await user.click(
      await screen.findByRole('button', {name: '删除 suppliers.csv'}),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('确定删除数据源「suppliers.csv」吗');
    await user.click(within(dialog).getByRole('button', {name: '删除'}));
    await waitFor(() => expect(db.sources).toHaveLength(0));
  });

  it('hides Modeler actions from operators', async () => {
    renderApp('/sources', {user: operatorUser});
    await screen.findByRole('table', {name: '数据接入'});
    expect(
      screen.queryByRole('link', {name: /新建数据源/}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: '删除 suppliers.csv'}),
    ).not.toBeInTheDocument();
  });
});
