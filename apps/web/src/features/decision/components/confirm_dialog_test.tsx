/**
 * @fileoverview Reusable decision components: ConfirmRecommendationDialog
 * with a pending summary (as used by the cockpit / Object View) and
 * RankedByBadge.
 */

import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {useSession} from '../../../entities/session/store';
import {candidates} from '../../../test/fixtures';
import {businessDb} from '../../../test/handlers/business';
import {renderWithProviders} from '../../../test/render';
import {ConfirmRecommendationDialog} from './confirm_dialog';
import {RankedByBadge} from './ranked_by_badge';

vi.mock('../../../app/router', () => ({routeTree: undefined}));

describe('ConfirmRecommendationDialog', () => {
  it('confirms a pending summary and reports the executed result', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ConfirmRecommendationDialog
        recommendation={{
          id: 'rec-203',
          summary: 'PO-5530 切换至备选供应商 S-022',
          candidates,
          ranking: ['c1', 'c2'],
        }}
        open
        onOpenChange={onOpenChange}
        onDone={onDone}
      />,
    );
    act(() =>
      useSession.getState().setGrant({accessToken: 'token-0', expiresIn: 900}),
    );
    const dialog = await screen.findByRole('dialog', {name: '确认并执行建议'});
    expect(dialog).toHaveTextContent('「PO-5530」执行「切换供应商」');
    await user.click(screen.getByRole('button', {name: '确认并执行'}));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0]).toMatchObject({
      id: 'rec-203',
      status: 'Executed',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const req = businessDb.requests.find(
      r => r.path === '/recommendations/rec-203/decision',
    );
    expect(req?.headers['idempotency-key']).toBeTruthy();
  });

  it('falls back to a generic explanation without candidates', async () => {
    renderWithProviders(
      <ConfirmRecommendationDialog
        recommendation={{id: 'rec-204', summary: '提高 M-2231 安全库存'}}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByText(/将执行排序第一的动作/)).toBeInTheDocument();
  });
});

describe('RankedByBadge', () => {
  it('shows the AI model or the rules label', () => {
    rtlRender(
      <RankedByBadge rankedBy="ai" model="@cf/qwen/qwen3-30b-a3b-fp8" />,
    );
    expect(screen.getByText('AI 排序（qwen3-30b-a3b）')).toBeInTheDocument();
    rtlRender(<RankedByBadge rankedBy="rules" showHint />);
    expect(screen.getByText('规则排序')).toBeInTheDocument();
    expect(
      screen.getByText(/今日 AI 额度已用完或 AI 暂不可用/),
    ).toBeInTheDocument();
  });
});
