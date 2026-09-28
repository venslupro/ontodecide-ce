/**
 * @fileoverview Shell additions (效果图 c2 / c9): notifications bell (OPEN
 * alerts + pending recommendations, local "seen"), sidebar pending badge,
 * global search over objects and alerts (grouped), the "About" dialog with
 * the build version, and traceId / version in error details.
 */

import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {AlertDto} from '@ontodecide/situation/contract';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  buildNotifications,
  markSeen,
  resetSeenCache,
  seenId,
} from '../../features/situation/notifications';
import {ErrorView} from '../../shared/ui/empty_state';
import {toast, Toaster} from '../../shared/ui/toast';
import {OWNER_TID} from '../../test/fixtures/platform';
import {businessDb} from '../../test/handlers/business';
import {renderApp} from '../../test/render';
import {filterAlerts} from './global_search';

function openCount() {
  return (
    businessDb.alerts.filter(a => a.status === 'OPEN').length +
    businessDb.recommendations.filter(r => r.status === 'Proposed').length
  );
}

/** In-memory Storage (Node's own localStorage shadows jsdom's here). */
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  resetSeenCache();
});
afterEach(() => vi.unstubAllGlobals());

const alert = (p: Partial<AlertDto>): AlertDto => ({
  id: 'a',
  automationId: 'au',
  automationName: {'zh-CN': 'x'},
  rid: null,
  title: 't',
  severity: 'LOW',
  status: 'OPEN',
  snapshot: {},
  hits: 1,
  raisedAt: '2026-09-28T10:00:00Z',
  ackedAt: null,
  closedAt: null,
  ...p,
});

describe('buildNotifications / filterAlerts', () => {
  it('keeps OPEN alerts and Proposed recommendations, newest first', () => {
    const items = buildNotifications(
      [
        alert({id: 'a1', raisedAt: '2026-09-28T09:00:00Z'}),
        alert({id: 'a2', status: 'ACKED'}),
      ],
      [
        {
          id: 'r1',
          summary: 'rec',
          status: 'Proposed',
          createdAt: '2026-09-28T11:00:00Z',
        },
        {
          id: 'r2',
          summary: 'old',
          status: 'Confirmed',
          createdAt: '2026-09-28T12:00:00Z',
        },
      ],
    );
    expect(items.map(seenId)).toEqual(['r:r1', 'a:a1']);
  });

  it('matches alert titles case-insensitively', () => {
    const list = [alert({id: 'x', title: 'Supplier S-017 down'})];
    expect(filterAlerts(list, 's-017')).toHaveLength(1);
    expect(filterAlerts(list, 'nothing')).toHaveLength(0);
    expect(filterAlerts(list, ' ')).toHaveLength(0);
  });
});

describe('notifications bell', () => {
  it('shows the unread count, lists items and marks them seen locally', async () => {
    const user = userEvent.setup();
    const {router} = renderApp('/account');
    const n = openCount();
    // The count merges three async queries; allow slow CI runners.
    const bell = await screen.findByRole(
      'button',
      {name: `通知（${n} 条未读）`},
      {timeout: 5000},
    );
    expect(within(bell).getByTestId('notification-count')).toHaveTextContent(
      String(n),
    );
    await user.click(bell);
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByText('供应商 S-017 产能下降 60%'),
    ).toBeInTheDocument();
    expect(
      within(menu).getByText('PO-5530 切换至备选供应商 S-022'),
    ).toBeInTheDocument();
    // Acknowledged alerts are not notifications.
    expect(within(menu).queryByText('PO-5530 逾期风险')).toBeNull();
    await user.click(within(menu).getByText('供应商 S-017 产能下降 60%'));
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/objects\//),
    );
    expect(
      await screen.findByRole(
        'button',
        {name: `通知（${n - 1} 条未读）`},
        {timeout: 5000},
      ),
    ).toBeInTheDocument();
    const stored = JSON.parse(
      localStorage.getItem(`od-notif-seen:${OWNER_TID}`) ?? '[]',
    ) as string[];
    expect(stored).toEqual(['a:al-cap']);
  });

  it('"mark all as read" clears the badge; a recommendation opens its page', async () => {
    const user = userEvent.setup();
    const {router} = renderApp('/account');
    await user.click(
      await screen.findByRole(
        'button',
        {name: /^通知（\d+ 条未读）$/},
        {timeout: 5000},
      ),
    );
    await user.click(await screen.findByRole('button', {name: '全部标为已读'}));
    await waitFor(() =>
      expect(screen.queryByTestId('notification-count')).toBeNull(),
    );
    const menu = screen.getByRole('menu');
    await user.click(within(menu).getByText('PO-5530 切换至备选供应商 S-022'));
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/recommendations\//),
    );
  });

  it('remembers seen ids across reloads (localStorage)', async () => {
    markSeen(OWNER_TID, ['a:al-cap', 'a:al-stock']);
    resetSeenCache();
    renderApp('/account');
    const n = openCount() - 2;
    expect(
      await screen.findByRole(
        'button',
        {name: `通知（${n} 条未读）`},
        {timeout: 5000},
      ),
    ).toBeInTheDocument();
  });
});

describe('sidebar pending badge', () => {
  it('shows the pending recommendation count on 建议中心', async () => {
    renderApp('/account');
    const pending = businessDb.recommendations.filter(
      r => r.status === 'Proposed',
    ).length;
    const link = await screen.findByRole('link', {
      name: new RegExp(`^建议中心\\s*${pending} 条待确认$`),
    });
    expect(within(link).getByTestId('pending-rec-badge')).toHaveTextContent(
      String(pending),
    );
  });
});

describe('global search', () => {
  it('finds objects and alerts in two groups; an alert opens its object', async () => {
    const user = userEvent.setup();
    const {router} = renderApp('/account');
    await user.type(
      await screen.findByRole('combobox', {name: '全局检索'}),
      'S-017',
    );
    const alerts = await screen.findByRole('group', {name: '告警'});
    const option = within(alerts).getByRole('option', {
      name: /供应商 S-017 产能下降 60%/,
    });
    await user.click(option);
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/objects\//),
    );
  });

  it('keyboard selection walks objects then alerts', async () => {
    const user = userEvent.setup();
    renderApp('/account');
    const box = await screen.findByRole('combobox', {name: '全局检索'});
    await user.type(box, 'M-2231');
    await screen.findByRole('group', {name: '告警'});
    const list = document.getElementById(box.getAttribute('aria-controls')!)!;
    const options = within(list).getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    for (let i = 1; i < options.length; i++) await user.keyboard('{ArrowDown}');
    expect(options.at(-1)).toHaveAttribute('aria-selected', 'true');
  });
});

describe('about + error details', () => {
  it('shows the build version in the account menu "About"', async () => {
    const user = userEvent.setup();
    renderApp('/account');
    await user.click(await screen.findByRole('button', {name: '账户菜单'}));
    await user.click(await screen.findByRole('menuitem', {name: '关于'}));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('版本 test')).toBeInTheDocument();
  });

  it('ErrorView and error toasts show the traceId and version', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ErrorView detail="boom" traceId="trace-123" />
        <Toaster />
      </>,
    );
    expect(screen.getByText('trace-123')).toBeInTheDocument();
    expect(screen.getAllByText('版本 test').length).toBeGreaterThan(0);
    toast.error('失败', undefined, {traceId: 'trace-456'});
    await user.click(await screen.findByText('详情'));
    expect(screen.getByText('trace-456')).toBeVisible();
  });
});
