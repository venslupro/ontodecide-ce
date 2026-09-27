/**
 * @fileoverview Import list and job pages: jobs with status and counts,
 * CTA to the wizard; job totals, rejects (row / column / code, never cell
 * values) and the link to objects of the target type.
 */

import {screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {renderApp, renderWithProviders} from '../../test/render';
import {ImportJobPage} from './import_job_page';
import {ImportsPage} from './imports_page';

describe('ImportsPage', () => {
  it('lists jobs with status and counts', async () => {
    renderWithProviders(<ImportsPage />, {url: '/imports'});
    const link = await screen.findByRole('link', {name: 'supplier_update.csv'});
    expect(link).toHaveAttribute('href', '/imports/imp-0412');
    const row = link.closest('tr')!;
    expect(within(row).getByText('已完成')).toBeInTheDocument();
    expect(within(row).getByText('212')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '示例场景'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /新建导入/})).toHaveAttribute(
      'href',
      '/imports/new',
    );
  });
});

describe('ImportJobPage', () => {
  it('shows totals and rejects without cell values', async () => {
    renderWithProviders(<ImportJobPage jobId="imp-0412" />, {
      url: '/imports/imp-0412',
    });
    expect(
      await screen.findByRole('heading', {name: 'supplier_update.csv'}),
    ).toBeInTheDocument();
    const totals = screen.getByLabelText('导入统计');
    expect(within(totals).getByText('200')).toBeInTheDocument();
    expect(within(totals).getByText('7')).toBeInTheDocument();
    const rejects = screen.getByRole('table', {name: '拒绝原因'});
    const r130 = within(rejects).getByText('130').closest('tr')!;
    expect(within(r130).getByText('必填项为空')).toBeInTheDocument();
    expect(within(r130).getByText('vendor_code')).toBeInTheDocument();
    expect(within(rejects).getByText('类型不匹配')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: /查看 Supplier 对象/}),
    ).toHaveAttribute('href', '/objects?type=Supplier');
  });

  it('reads the id from the route', async () => {
    renderApp('/imports/imp-0412');
    expect(
      await screen.findByRole(
        'heading',
        {name: 'supplier_update.csv'},
        {timeout: 5000},
      ),
    ).toBeInTheDocument();
  });

  it('shows not found for an unknown job', async () => {
    renderWithProviders(<ImportJobPage jobId="imp-none" />);
    expect(await screen.findByText('找不到该导入作业。')).toBeInTheDocument();
  });
});
