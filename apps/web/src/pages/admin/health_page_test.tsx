/**
 * @fileoverview System health page: quota rows with status, degraded
 * states, dead letters with replay, graph rebuild.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {renderApp} from '../../test/render';
import {server} from '../../test/server';

describe('HealthPage', () => {
  it('lists quota resources with a warn status for D1 rows written', async () => {
    renderApp('/admin/health');
    const table = await screen.findByRole('table', {name: '免费额度占用明细'});
    const d1 = within(table).getByText('D1 写入行').closest('tr')!;
    expect(within(d1).getByText('偏高')).toBeInTheDocument();
    expect(within(d1).getByText('83,000 / 100,000')).toBeInTheDocument();
    const kv = within(table).getByText('KV 写入').closest('tr')!;
    expect(within(kv).getByText('正常')).toBeInTheDocument();
    expect(screen.getByRole('img', {name: /80% 告警线/})).toBeInTheDocument();
  });

  it('shows degraded dependency cards', async () => {
    renderApp('/admin/health');
    expect(await screen.findByText('Neo4j 图数据库')).toBeInTheDocument();
    expect(screen.getByText('大模型服务')).toBeInTheDocument();
    expect(screen.getByText(/已切换至备用模型 gemini/)).toBeInTheDocument();
    expect(screen.getByText('1 项依赖处于降级')).toBeInTheDocument();
  });

  it('lists dead letters and replays the selected ones', async () => {
    const calls: {queue: string; body: unknown}[] = [];
    server.use(
      http.post(
        '*/api/v1/admin/dlq/:queue/replay',
        async ({params, request}) => {
          calls.push({
            queue: params.queue as string,
            body: await request.json(),
          });
          return HttpResponse.json({replayed: 1});
        },
      ),
    );
    renderApp('/admin/health');
    const user = userEvent.setup();
    const table = await screen.findByRole('table', {name: '死信队列'});
    expect(within(table).getByText('dl-1')).toBeInTheDocument();
    expect(within(table).getByText('dl-2')).toBeInTheDocument();
    const replaySelected = screen.getByRole('button', {name: /重放选中/});
    expect(replaySelected).toBeDisabled();

    await user.click(within(table).getByRole('checkbox', {name: '选择 dl-1'}));
    await user.click(screen.getByRole('button', {name: '重放选中（1）'}));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', {name: '重放'}));
    await waitFor(() =>
      expect(calls).toEqual([
        {queue: 'object-writes-dlq', body: {ids: ['dl-1']}},
      ]),
    );
    expect(await screen.findByText('已重放 1 条消息')).toBeInTheDocument();
  });

  it('replays a whole queue and rebuilds the graph projection', async () => {
    const calls: {queue: string; body: unknown}[] = [];
    server.use(
      http.post(
        '*/api/v1/admin/dlq/:queue/replay',
        async ({params, request}) => {
          calls.push({
            queue: params.queue as string,
            body: await request.json(),
          });
          return HttpResponse.json({replayed: 1});
        },
      ),
    );
    renderApp('/admin/health');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {name: '全部重放 decision-jobs-dlq'}),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '重放',
      }),
    );
    await waitFor(() =>
      expect(calls).toEqual([{queue: 'decision-jobs-dlq', body: {}}]),
    );

    await user.click(screen.getByRole('button', {name: '重建图投影'}));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '重建图投影',
      }),
    );
    expect(
      await screen.findByText('已排队 10 个对象重建投影'),
    ).toBeInTheDocument();
  });
});
