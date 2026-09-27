/**
 * @fileoverview Import wizard main flow with MSW: choose target type,
 * upload a CSV (parsed in the browser), deterministic + AI mapping with
 * explicit confirmation, validation (primary key empty), upload plan and
 * run (batches recorded in businessDb.requests), then the job page; plus
 * the over-limit plan and the rules-only draft.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {businessDb} from '../../test/handlers/business';
import {renderWithProviders} from '../../test/render';
import {ImportWizardPage} from './import_wizard_page';

const CSV = [
  '\uFEFFvendor_code,vendor_name,risk,addr.country,ont_pct,note',
  'S-017,苏州精密零件,82,CN,0.93,secret',
  'S-022,宁波恒达机电,21,CN,0.88,',
  'S-031,Tokyo Parts KK,47,JP,0.97,',
  ',空主键,130,CN,0.5,',
  '',
  'S-040,Hanoi Metal,55,VN,0.8,',
].join('\n');

function csvFile(text = CSV, name = 'vendors.csv') {
  return new File([text], name, {type: 'text/csv'});
}

async function toMapping(user: ReturnType<typeof userEvent.setup>, file: File) {
  const select = await screen.findByLabelText(/目标对象类型/);
  await waitFor(() =>
    expect(
      within(select).getByRole('option', {name: /Supplier/}),
    ).toBeInTheDocument(),
  );
  await user.selectOptions(select, 'Supplier');
  await user.click(screen.getByRole('button', {name: '下一步：上传文件'}));
  expect(screen.getByText(/原始文件不会上传/)).toBeInTheDocument();
  await user.upload(screen.getByLabelText('导入文件'), file);
  expect(await screen.findByText(/已解析 5 行/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', {name: '下一步：字段映射'}));
}

describe('ImportWizardPage', () => {
  it('parses, maps, validates and uploads in batches', async () => {
    const user = userEvent.setup();
    const {router} = renderWithProviders(<ImportWizardPage />, {
      url: '/imports/new',
    });
    await toMapping(user, csvFile());
    expect(screen.getByText('vendors.csv · 5 行')).toBeInTheDocument();

    // Deterministic matches from the client auto-match.
    const pkRow = screen.getByTestId('mapping-row-vendor_code');
    expect(within(pkRow).getByText('确定性匹配')).toBeInTheDocument();
    expect(
      within(pkRow).getByRole('combobox', {name: 'vendor_code 的目标属性'}),
    ).toHaveValue('prop:supplierId');
    expect(screen.getByText(/今日剩余/)).toBeInTheDocument();

    // AI draft: creates the job, sends fields + aligned samples.
    await user.click(screen.getByRole('button', {name: /AI 生成映射草稿/}));
    const aiRow = await screen.findByTestId('mapping-row-ont_pct');
    await within(aiRow).findByText('AI 建议');
    const draftReq = businessDb.requests.find(r =>
      r.path.endsWith('/mapping-draft'),
    )!;
    const body = draftReq.body as {fields: string[]; sampleRows: unknown[][]};
    expect(body.fields).toContain('ont_pct');
    expect(body.sampleRows[0]).toHaveLength(body.fields.length);
    expect(body.sampleRows.length).toBeLessThanOrEqual(20);
    const created = businessDb.requests.filter(
      r => r.method === 'POST' && r.path === '/imports',
    );
    expect(created).toHaveLength(1);
    expect(created[0].body).toMatchObject({
      fileName: 'vendors.csv',
      targetType: 'Supplier',
      totalRows: 5,
    });

    const next = screen.getByRole('button', {name: '下一步：校验'});
    expect(next).toBeDisabled();
    expect(screen.getByText('还有 1 项 AI 建议待确认。')).toBeInTheDocument();
    await user.click(
      within(aiRow).getByRole('button', {name: '确认 ont_pct 的映射'}),
    );
    expect(within(aiRow).getByText('已确认')).toBeInTheDocument();
    expect(next).toBeEnabled();
    await user.click(next);

    // Validation: row 4 has an empty primary key.
    expect(await screen.findByText('4 通过')).toBeInTheDocument();
    expect(screen.getByText('1 拒绝')).toBeInTheDocument();
    const table = screen.getByRole('table', {name: '校验'});
    const row4 = within(table).getByText('4').closest('tr')!;
    expect(within(row4).getByText('主键为空')).toBeInTheDocument();
    expect(within(row4).getByText('vendor_code')).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: '下一步：预览与运行'}));
    expect(
      screen.getByText('浏览器内解析 → 1 批 × 5 行（原始文件不上传）'),
    ).toBeInTheDocument();
    const preview = screen.getByRole('table', {name: '预览'});
    expect(within(preview).getByText('苏州精密零件')).toBeInTheDocument();
    expect(within(preview).getByText('0.93')).toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: '开始导入'}));
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/imports\/imp-/),
    );

    const jobId = router.state.location.pathname.split('/').pop()!;
    // The draft job was reused; mapping then one sequential batch.
    expect(
      businessDb.requests.filter(
        r => r.method === 'POST' && r.path === '/imports',
      ),
    ).toHaveLength(1);
    const put = businessDb.requests.find(r => r.method === 'PUT')!;
    expect(put.path).toBe(`/imports/${jobId}/mapping`);
    expect(put.body).toMatchObject({
      mapping: {
        targetType: 'Supplier',
        primaryKey: {from: 'vendor_code', transform: 'trim'},
      },
    });
    const batches = businessDb.requests.filter(r =>
      r.path.endsWith('/batches'),
    );
    expect(
      batches.map(b => (b.body as {seq: number; last: boolean}).seq),
    ).toEqual([0]);
    const batch = batches[0].body as {
      last: boolean;
      rows: Record<string, unknown>[];
    };
    expect(batch.last).toBe(true);
    expect(batch.rows).toHaveLength(5);
    // Only mapped columns are sent (never the unmapped `note`).
    expect(batch.rows[0]).not.toHaveProperty('note');
    expect(batch.rows[0]).toMatchObject({
      vendor_code: 'S-017',
      ont_pct: '0.93',
    });
    const job = businessDb.jobs.find(j => j.id === jobId)!;
    expect(job).toMatchObject({
      status: 'DONE',
      received: 5,
      upserted: 4,
      rejected: 1,
    });
  });

  it('marks rows beyond the remaining import rows as over-limit', async () => {
    businessDb.quotas.importRowsToday = {used: 1997, limit: 2000};
    const user = userEvent.setup();
    renderWithProviders(<ImportWizardPage />, {url: '/imports/new'});
    await toMapping(user, csvFile(CSV.replace(',空主键,', 'S-099,Filled,')));
    await user.click(screen.getByRole('button', {name: '下一步：校验'}));
    expect(await screen.findByText('3 通过')).toBeInTheDocument();
    expect(screen.getByText('2 超出上限')).toBeInTheDocument();
    expect(screen.getByText('第 4–5 行')).toBeInTheDocument();
    expect(
      screen.getByText('超出上限：今日剩余导入行数 3'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: '下一步：预览与运行'}));
    expect(
      screen.getByText('浏览器内解析 → 1 批 × 3 行（原始文件不上传）'),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 行超出上限/)).toBeInTheDocument();
  });

  it('notes a rules-only draft when the AI quota is used up', async () => {
    businessDb.quotas.mappingDraftsToday = {used: 2, limit: 2};
    const user = userEvent.setup();
    renderWithProviders(<ImportWizardPage />, {url: '/imports/new'});
    await toMapping(user, csvFile());
    await user.click(screen.getByRole('button', {name: /AI 生成映射草稿/}));
    expect(await screen.findByText(/未使用 AI/)).toBeInTheDocument();
    expect(screen.queryByText('AI 建议')).not.toBeInTheDocument();
  });

  it('rejects files over 5 MB before reading them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ImportWizardPage />, {url: '/imports/new'});
    const select = await screen.findByLabelText(/目标对象类型/);
    await waitFor(() =>
      expect(within(select).getAllByRole('option').length).toBeGreaterThan(1),
    );
    await user.selectOptions(select, 'Supplier');
    await user.click(screen.getByRole('button', {name: '下一步：上传文件'}));
    const big = csvFile('a\n1');
    Object.defineProperty(big, 'size', {value: 6 * 1024 * 1024});
    await user.upload(screen.getByLabelText('导入文件'), big);
    expect(await screen.findByRole('alert')).toHaveTextContent('5 MB');
    expect(
      screen.getByRole('button', {name: '下一步：字段映射'}),
    ).toBeDisabled();
  });
});
