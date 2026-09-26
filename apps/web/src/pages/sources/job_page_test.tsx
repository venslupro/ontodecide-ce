/**
 * @fileoverview Job page: counters, quality and progress render; editing a
 * rejected record and replaying posts the corrected payload; "全部重放"
 * without edits replays everything as-is.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {renderApp} from '../../test/render';
import {server} from '../../test/server';

function captureReplay() {
  const bodies: unknown[] = [];
  server.use(
    http.post('*/api/v1/jobs/:id/replay', async ({request}) => {
      const body = (await request.json()) as {fixes?: unknown[]};
      bodies.push(body);
      return HttpResponse.json({requeued: body.fixes?.length ?? 2});
    }),
  );
  return bodies;
}

describe('JobPage', () => {
  it('renders status, counters, quality and progress', async () => {
    renderApp('/jobs/job-1');
    expect(
      await screen.findByRole('heading', {name: '导入作业'}),
    ).toBeInTheDocument();
    expect(screen.getAllByText('部分失败').length).toBeGreaterThan(0);
    const counter = (label: string) => screen.getByRole('group', {name: label});
    expect(counter('接收')).toHaveTextContent('10');
    expect(counter('写入')).toHaveTextContent('7');
    expect(counter('合并')).toHaveTextContent('1');
    expect(counter('跳过')).toHaveTextContent('0');
    expect(counter('拒绝')).toHaveTextContent('2');
    expect(screen.getByText('质量分 80.0%')).toBeInTheDocument();
    expect(screen.getByText('1 / 1 个消息组')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', {name: '处理进度'})).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(
      await screen.findByText('数据源：suppliers.csv'),
    ).toBeInTheDocument();
  });

  it('edits a rejected record and replays the fix', async () => {
    const bodies = captureReplay();
    const user = userEvent.setup();
    renderApp('/jobs/job-1');
    const table = await screen.findByRole('table', {name: '拒绝记录'});
    expect(
      within(table).getByText('riskScore is not a number'),
    ).toBeInTheDocument();
    expect(within(table).getByText('REQUIRED')).toBeInTheDocument();

    const replayBtn = screen.getByRole('button', {name: '修正并重放'});
    expect(replayBtn).toBeDisabled();

    const risk = screen.getByLabelText('第 4 行 riskScore');
    expect(risk).toHaveValue('abc');
    await user.clear(risk);
    await user.type(risk, '42');
    const name = screen.getByLabelText('第 4 行 name');
    await user.type(name, 'Fixed Co');
    expect(screen.getByText('已选 1 行 · 已修改 1 行')).toBeInTheDocument();

    await user.click(replayBtn);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      fixes: [
        {
          id: 'rr-1',
          payload: {supplierId: 'S-009', name: 'Fixed Co', riskScore: '42'},
        },
      ],
    });
    expect(await screen.findByText('已重新入队 1 条记录')).toBeInTheDocument();
  });

  it('keeps numeric types when correcting and replays all without edits', async () => {
    const bodies = captureReplay();
    const user = userEvent.setup();
    renderApp('/jobs/job-1');
    await screen.findByRole('table', {name: '拒绝记录'});
    await user.click(screen.getByRole('button', {name: '全部重放'}));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({});

    const risk = screen.getByLabelText('第 7 行 riskScore');
    await user.clear(risk);
    await user.type(risk, '60');
    await user.type(screen.getByLabelText('第 7 行 supplierId'), 'S-010');
    await user.click(screen.getByRole('button', {name: '修正并重放'}));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({
      fixes: [
        {
          id: 'rr-2',
          payload: {supplierId: 'S-010', name: 'Nameless Co', riskScore: 60},
        },
      ],
    });
  });
});
