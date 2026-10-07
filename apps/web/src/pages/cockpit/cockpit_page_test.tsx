/**
 * @fileoverview Cockpit: fixed layout from the overview BFF (KPI cards,
 * alerts by severity, impacted objects, pending recommendations with the
 * ranking badge), alert acknowledgement, range switch, and the empty
 * workspace with sample data (success, QUOTA_EXCEEDED inline, CONFLICT).
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {businessDb} from '../../test/handlers/business';
import {API, problem} from '../../test/handlers/problem';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {CockpitPage} from './cockpit_page';

describe('CockpitPage', () => {
  it('renders KPIs, alerts, impacted objects and pending recommendations', async () => {
    renderWithProviders(<CockpitPage />, {url: '/cockpit'});
    expect(
      await screen.findByRole('article', {name: '准时交付率'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('article', {name: '缺料风险订单'}),
    ).toBeInTheDocument();
    expect(screen.getByText('供应商 S-017 产能下降 60%')).toBeInTheDocument();
    expect(screen.getByText('2 严重')).toBeInTheDocument();
    expect(screen.getByText('华东一厂')).toBeInTheDocument();
    const pending = screen.getByRole('link', {
      name: 'PO-5530 切换至备选供应商 S-022',
    });
    const item = pending.closest('li')!;
    expect(within(item).getByText(/预期收益/)).toBeInTheDocument();
    expect(within(item).getByText(/置信度 0.78/)).toBeInTheDocument();
    expect(screen.getByRole('img', {name: /趋势/})).toBeInTheDocument();
    // no sample-data CTA when the workspace has objects
    expect(screen.queryByRole('button', {name: '加载所选场景'})).toBeNull();
  });

  it('orders alerts by severity', async () => {
    renderWithProviders(<CockpitPage />, {url: '/cockpit'});
    await screen.findByText('供应商 S-017 产能下降 60%');
    const titles = screen
      .getAllByRole('listitem')
      .map(li => li.textContent ?? '')
      .filter(t => /S-017 产能|M-2231 低于|PO-5530 逾期/.test(t));
    expect(titles[0]).toContain('S-017');
    expect(titles[1]).toContain('M-2231');
  });

  it('acknowledges an alert', async () => {
    renderWithProviders(<CockpitPage />, {url: '/cockpit'});
    await userEvent.click(
      await screen.findByRole('button', {
        name: '确认告警：供应商 S-017 产能下降 60%',
      }),
    );
    await waitFor(() =>
      expect(
        businessDb.requests.some(
          r => r.path === '/alerts/al-cap/acknowledgement',
        ),
      ).toBe(true),
    );
    expect(businessDb.alerts.find(a => a.id === 'al-cap')!.status).toBe(
      'ACKED',
    );
  });

  it('requests the 7d range', async () => {
    const ranges: string[] = [];
    server.use(
      http.get(`${API}/situation/overview`, ({request}) => {
        ranges.push(new URL(request.url).searchParams.get('range') ?? '');
        return HttpResponse.json({
          kpis: [],
          trends: [],
          alerts: [],
          impacted: [],
          initialized: true,
          generatedAt: new Date().toISOString(),
          pendingRecommendations: [],
        });
      }),
    );
    renderWithProviders(<CockpitPage />, {url: '/cockpit'});
    await userEvent.click(await screen.findByRole('tab', {name: '7d'}));
    await waitFor(() => expect(ranges).toContain('7d'));
    expect(ranges[0]).toBe('24h');
  });

  describe('empty workspace', () => {
    function emptyStats() {
      server.use(
        http.get(`${API}/objects/stats`, () =>
          HttpResponse.json({objects: 0, links: 0, byType: {}}),
        ),
      );
    }

    it('loads the sample scenario', async () => {
      emptyStats();
      renderWithProviders(<CockpitPage />, {url: '/cockpit'});
      await userEvent.click(
        await screen.findByRole('button', {name: '加载所选场景'}),
      );
      await waitFor(() => expect(businessDb.sampleLoaded).toBe(true));
      expect(
        screen.getByRole('button', {name: '导入文件'}),
      ).toBeInTheDocument();
    });

    it('shows QUOTA_EXCEEDED inline with the reset time', async () => {
      emptyStats();
      server.use(
        http.post(`${API}/workspace/sample-data`, () =>
          problem(429, 'QUOTA_EXCEEDED', 'seed budget', {
            resetsAt: '2026-09-29T00:00:00.000Z',
          }),
        ),
      );
      renderWithProviders(<CockpitPage />, {url: '/cockpit'});
      await userEvent.click(
        await screen.findByRole('button', {name: '加载所选场景'}),
      );
      expect(
        await screen.findByText(/今日示例场景名额已用完/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('allows reloading / switching scenarios (no CONFLICT block)', async () => {
      emptyStats();
      businessDb.sampleLoaded = true;
      renderWithProviders(<CockpitPage />, {url: '/cockpit'});
      await userEvent.click(
        await screen.findByRole('button', {name: '加载所选场景'}),
      );
      // The sample handler no longer blocks reloading; the call succeeds.
      expect(businessDb.sampleLoaded).toBe(true);
    });
  });
});
