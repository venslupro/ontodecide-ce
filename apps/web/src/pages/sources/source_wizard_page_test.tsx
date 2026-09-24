/**
 * @fileoverview Data source wizard: upload a CSV (main-thread fallback
 * parser in jsdom), choose Supplier, create the source, then generate an AI
 * mapping draft — suggestions carry the AI badge and are not applied until
 * confirmed; after "全部接受" the mapping preview reflects them.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {db} from '../../test/handlers';
import {renderApp} from '../../test/render';
import {server} from '../../test/server';

const CSV = `supplierId,name,riskScore,region
S-001,Shenzhen Precision Parts,35,South
S-002,Hanoi Circuit Works,58,North
S-003,Penang Semicon,22,West
`;

async function goToMapping() {
  const user = userEvent.setup();
  renderApp('/sources/new');
  expect(
    await screen.findByRole('heading', {name: '新建数据源'}),
  ).toBeInTheDocument();
  expect(screen.getByRole('radio', {name: /文件上传/})).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.click(screen.getByRole('button', {name: '下一步'}));

  const input = await screen.findByLabelText('选择要上传的文件');
  await user.upload(
    input,
    new File([CSV], 'suppliers.csv', {type: 'text/csv'}),
  );
  const summary = await screen.findByLabelText('文件信息');
  expect(within(summary).getByText('suppliers.csv')).toBeInTheDocument();
  expect(within(summary).getByText('3 行')).toBeInTheDocument();
  expect(screen.getByRole('table', {name: '样例数据'})).toHaveTextContent(
    'Hanoi Circuit Works',
  );
  expect(screen.getByLabelText(/数据源名称/)).toHaveValue('suppliers.csv');

  await user.selectOptions(screen.getByLabelText(/目标对象类型/), 'Supplier');
  await user.click(screen.getByRole('button', {name: '下一步'}));
  expect(
    await screen.findByRole('heading', {name: '字段映射'}),
  ).toBeInTheDocument();
  return user;
}

describe('SourceWizardPage', () => {
  it('rejects oversized files with a split hint', async () => {
    const user = userEvent.setup();
    renderApp('/sources/new');
    await user.click(await screen.findByRole('button', {name: '下一步'}));
    const input = await screen.findByLabelText('选择要上传的文件');
    const big = new File(['x'], 'big.csv', {type: 'text/csv'});
    Object.defineProperty(big, 'size', {value: 20 * 1024 * 1024 + 1});
    await user.upload(input, big);
    expect(await screen.findByRole('alert')).toHaveTextContent('请拆分文件');
  });

  it('creates the source and requires confirming AI mapping suggestions', async () => {
    let suggestBody: {
      fields: string[];
      rows: unknown[][];
      targetType: string;
    } | null = null;
    server.use(
      http.post(
        /\/api\/v1\/sources\/[^/]+\/mapping:suggest$/,
        async ({request}) => {
          suggestBody = (await request.json()) as typeof suggestBody;
          return HttpResponse.json({
            targetType: 'Supplier',
            primaryKey: {from: 'supplierId'},
            fields: [
              {from: 'name', to: 'name', transform: 'trim', confidence: 0.93},
              {
                from: 'riskScore',
                to: 'riskScore',
                transform: 'toNumber|clamp(0,100)',
                confidence: 0.81,
              },
            ],
            model: 'test-model',
          });
        },
      ),
    );
    const user = await goToMapping();

    // The source was created disabled, with a provisional mapping (PK guess).
    const created = db.sources.at(-1)!;
    expect(created).toMatchObject({
      name: 'suppliers.csv',
      kind: 'file',
      enabled: false,
    });
    expect(created.mapping).toMatchObject({
      targetType: 'Supplier',
      primaryKey: {from: 'supplierId'},
      fields: [],
    });

    const preview = screen.getByRole('region', {name: '映射预览'});
    expect(within(preview).getByText('S-001')).toBeInTheDocument();
    expect(within(preview).queryByText('风险分')).not.toBeInTheDocument();

    // Remaining AI quota is shown next to the button.
    expect(await screen.findByText('今日剩余 17 次')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'AI 生成映射草稿'}));

    const suggestion = await screen.findByTestId('ai-suggestion-riskScore');
    expect(within(suggestion).getByText('AI 建议')).toBeInTheDocument();
    expect(within(suggestion).getByText('置信度 81%')).toBeInTheDocument();
    expect(screen.getAllByText('AI 建议').length).toBeGreaterThanOrEqual(2);
    expect(suggestBody).toMatchObject({
      fields: ['supplierId', 'name', 'riskScore', 'region'],
      targetType: 'Supplier',
      rows: [
        ['S-001', 'Shenzhen Precision Parts', '35', 'South'],
        ['S-002', 'Hanoi Circuit Works', '58', 'North'],
        ['S-003', 'Penang Semicon', '22', 'West'],
      ],
    });

    // Not applied yet: targets unchanged and the preview does not show them.
    expect(screen.getByLabelText('riskScore 的目标属性')).toHaveValue('');
    expect(within(preview).queryByText('风险分')).not.toBeInTheDocument();
    expect(screen.getByText(/2 条 AI 建议待确认/)).toBeInTheDocument();

    // Confirm one row → only that row is applied.
    await user.click(
      screen.getByRole('button', {name: '确认 name 的 AI 建议'}),
    );
    expect(screen.getByLabelText('name 的目标属性')).toHaveValue('name');
    expect(within(preview).getByText('名称')).toBeInTheDocument();
    expect(within(preview).queryByText('风险分')).not.toBeInTheDocument();

    // Accept all → the preview reflects the transformed value.
    await user.click(screen.getByRole('button', {name: '全部接受'}));
    await waitFor(() =>
      expect(within(preview).getByText('风险分')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('riskScore 的目标属性')).toHaveValue(
      'riskScore',
    );
    expect(within(preview).getByText('35')).toBeInTheDocument();
    expect(
      screen.queryByTestId('ai-suggestion-riskScore'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('已确认').length).toBeGreaterThanOrEqual(2);
  });
});
