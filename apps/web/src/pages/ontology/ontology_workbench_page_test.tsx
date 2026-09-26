/**
 * @fileoverview Ontology workbench: loads the supply-chain schema, edits
 * mark the draft dirty and save PUTs it, breaking publish needs the
 * suggested version typed.
 */

import type {SchemaDef} from '@ontodecide/ontology/contract';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {NOW} from '../../test/fixtures';
import {renderApp} from '../../test/render';
import {server} from '../../test/server';

describe('OntologyWorkbenchPage', () => {
  it('loads the supplyChain schema into the type tree', async () => {
    renderApp('/ontology/supplyChain');
    const tree = await screen.findByRole('navigation', {name: '本体结构'});
    expect(within(tree).getByText('供应商')).toBeInTheDocument();
    expect(within(tree).getByText('物料')).toBeInTheDocument();
    expect(within(tree).getByText('产品')).toBeInTheDocument();
    expect(within(tree).getByText('切换供应商')).toBeInTheDocument();
    expect(within(tree).getByText('可满足日需求')).toBeInTheDocument();
    // Supplier is selected: its properties are editable.
    expect(screen.getByLabelText('riskScore 中文名')).toHaveValue('风险分');
    expect(
      screen.getByRole('img', {name: /Schema 关系图：3 个对象类型，2 个关系/}),
    ).toBeInTheDocument();
  });

  it('marks edits dirty and saves the draft with PUT', async () => {
    let saved: SchemaDef | undefined;
    server.use(
      http.put(
        '*/api/v1/ontology/schemas/:api/draft',
        async ({request, params}) => {
          saved = (await request.json()) as SchemaDef;
          return HttpResponse.json({
            apiName: params.api,
            version: '1.1.0',
            savedAt: NOW,
            validation: [
              {
                path: 'objectTypes.Supplier.properties.riskScore',
                message: 'demo issue',
              },
            ],
          });
        },
      ),
    );
    renderApp('/ontology/supplyChain');
    const user = userEvent.setup();
    const input = await screen.findByLabelText('riskScore 中文名');
    expect(screen.getByText('已保存')).toBeInTheDocument();
    const save = screen.getByRole('button', {name: '保存草稿'});
    expect(save).toBeDisabled();

    await user.clear(input);
    await user.type(input, '风险评分');
    expect(await screen.findByText('有未保存的更改')).toBeInTheDocument();
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(saved).toBeDefined());
    const supplier = saved!.objectTypes.find(o => o.apiName === 'Supplier')!;
    const risk = supplier.properties.find(p => p.apiName === 'riskScore')!;
    expect(risk.displayName).toEqual({
      'zh-CN': '风险评分',
      'en-US': 'Risk score',
    });
    expect(await screen.findByText('已保存')).toBeInTheDocument();
    // Validation issues are listed with their paths.
    expect(
      await screen.findByText('objectTypes.Supplier.properties.riskScore'),
    ).toBeInTheDocument();
    expect(screen.getByText('demo issue')).toBeInTheDocument();
  });

  it('shows the breaking diff and requires the suggested version to publish', async () => {
    let publishBody: unknown;
    server.use(
      http.post(
        '*/api/v1/ontology/schemas/:api/publish',
        async ({request, params}) => {
          publishBody = await request.json();
          return HttpResponse.json({
            apiName: params.api,
            version: '2.0.0',
            diff: {
              apiName: params.api,
              fromVersion: '1.0.0',
              toVersion: '2.0.0',
              breaking: true,
              changes: [],
              suggestedVersion: '2.0.0',
            },
            indexChanges: [],
            publishedAt: NOW,
          });
        },
      ),
    );
    renderApp('/ontology/supplyChain');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: '对比与发布'}));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('包含 1 项破坏性变更'),
    ).toBeInTheDocument();
    const row = within(dialog).getByText('Supplier.capacity').closest('tr')!;
    expect(within(row).getByText('破坏性')).toBeInTheDocument();
    expect(within(row).getByText('double → integer')).toBeInTheDocument();

    const publish = within(dialog).getByRole('button', {name: '发布 v2.0.0'});
    expect(publish).toBeDisabled();
    const confirm =
      within(dialog).getByLabelText('输入新版本号 2.0.0 以确认发布');
    await user.type(confirm, '2.0');
    expect(publish).toBeDisabled();
    await user.type(confirm, '.0');
    expect(publish).toBeEnabled();
    await user.click(publish);

    await waitFor(() => expect(publishBody).toEqual({confirmVersion: '2.0.0'}));
    expect(await screen.findByText('已发布 v2.0.0')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
});
