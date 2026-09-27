/**
 * @fileoverview 429 RATE_LIMITED: the store and hook, and the countdown on
 * the buttons of the action that got it (e-mail code send, decisions,
 * actions) — disabled with "N 秒后可重试", re-enabled at zero.
 * QUOTA_EXCEEDED is not trapped.
 */

import {act, renderHook, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {http} from 'msw';
import {describe, expect, it, vi} from 'vitest';
import {ConfirmRecommendationDialog} from '../../features/decision/components/confirm_dialog';
import {EmailCodeFlow} from '../../features/identity/components/email_code_flow';
import {candidates} from '../../test/fixtures';
import {problem} from '../../test/handlers';
import {renderWithProviders} from '../../test/render';
import {server} from '../../test/server';
import {ApiError} from './errors';
import {
  DEFAULT_RETRY_AFTER_S,
  rateLimitedUntil,
  trapRateLimit,
  useRetryAfter,
} from './rate_limit';

vi.mock('../../app/router', () => ({routeTree: undefined}));

const limited = (retryAfter?: number) =>
  new ApiError({code: 'RATE_LIMITED', status: 429, retryAfter});

describe('trapRateLimit', () => {
  it('starts a Retry-After wait only for RATE_LIMITED', () => {
    expect(trapRateLimit('k', limited(7), 1000)).toBe(true);
    expect(rateLimitedUntil('k')).toBe(8000);
    expect(
      trapRateLimit(
        'q',
        new ApiError({code: 'QUOTA_EXCEEDED', status: 429, retryAfter: 60}),
      ),
    ).toBe(false);
    expect(rateLimitedUntil('q')).toBeNull();
    expect(trapRateLimit('x', new Error('boom'))).toBe(false);
    trapRateLimit('d', limited(), 0);
    expect(rateLimitedUntil('d')).toBe(DEFAULT_RETRY_AFTER_S * 1000);
  });

  it('counts down and re-enables (hook, shared by key)', () => {
    vi.useFakeTimers();
    try {
      const a = renderHook(() => useRetryAfter('shared'));
      const b = renderHook(() => useRetryAfter('shared'));
      act(() => {
        a.result.current.trap(limited(2));
      });
      expect(a.result.current).toMatchObject({seconds: 2, limited: true});
      expect(b.result.current.limited).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(a.result.current.seconds).toBe(1);
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      expect(a.result.current).toMatchObject({seconds: 0, limited: false});
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('buttons with a Retry-After countdown', () => {
  it('e-mail code send', async () => {
    server.use(
      http.post('*/api/v1/auth/codes', () =>
        problem(429, 'RATE_LIMITED', undefined, {}, {'retry-after': '2'}),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <EmailCodeFlow
        purpose="login"
        onOutcome={() => {}}
        totalSteps={2}
        submitLabel="登录"
      />,
      {as: 'anonymous'},
    );
    await user.type(await screen.findByLabelText('邮箱'), 'a@b.co');
    await screen.findByText('人机验证已通过');
    await user.click(screen.getByRole('button', {name: '发送验证码'}));
    const btn = await screen.findByRole('button', {name: /秒后可重试/});
    expect(btn).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('操作太频繁');
    await waitFor(
      () =>
        expect(
          screen.getByRole('button', {name: '发送验证码'}),
        ).toBeInTheDocument(),
      {timeout: 4000},
    );
  });

  it('recommendation confirm', async () => {
    server.use(
      http.post('*/api/v1/recommendations/:id/decision', () =>
        problem(429, 'RATE_LIMITED', undefined, {}, {'retry-after': '30'}),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ConfirmRecommendationDialog
        recommendation={{
          id: 'rec-203',
          summary: 'PO-5530 切换至备选供应商 S-022',
          candidates,
          ranking: ['c1', 'c2'],
        }}
        open
        onOpenChange={() => {}}
      />,
    );
    await user.click(await screen.findByRole('button', {name: '确认并执行'}));
    const btn = await screen.findByRole('button', {name: /30 秒后可重试/});
    expect(btn).toBeDisabled();
  });
});
