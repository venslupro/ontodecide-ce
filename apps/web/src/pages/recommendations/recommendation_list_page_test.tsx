/**
 * @fileoverview Recommendation center: status tabs synced to `?status=`,
 * cards and per-status empty states.
 */

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import * as fx from '../../test/fixtures';
import {renderApp} from '../../test/render';

describe('RecommendationListPage', () => {
  it('shows proposed recommendations by default and filters by status', async () => {
    const {router} = renderApp('/recommendations', {user: fx.operatorUser});
    expect(
      await screen.findByText(fx.recommendation.summary, undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: '待审批'})).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', {name: '已驳回'}));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({status: 'Rejected'}),
    );
    expect(await screen.findByText('暂无已驳回的建议')).toBeInTheDocument();
  });

  it('reads the initial tab from ?status=', async () => {
    renderApp('/recommendations?status=All', {user: fx.operatorUser});
    expect(
      await screen.findByRole('tab', {name: '全部'}, {timeout: 5000}),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      await screen.findByText(fx.recommendation.summary),
    ).toBeInTheDocument();
  });
});
