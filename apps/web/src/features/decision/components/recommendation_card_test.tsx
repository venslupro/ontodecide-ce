/**
 * @fileoverview RecommendationCard: summary, AI / rules badge, confidence,
 * top action impact and status.
 */

import {screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import * as fx from '../../../test/fixtures';
import {renderWithProviders} from '../../../test/render';
import {RecommendationCard} from './recommendation_card';

describe('RecommendationCard', () => {
  it('renders summary, AI badge, confidence, impact and status', async () => {
    renderWithProviders(<RecommendationCard rec={fx.recommendation} />);
    expect(
      await screen.findByText(fx.recommendation.summary),
    ).toBeInTheDocument();
    expect(screen.getByText('AI 建议')).toBeInTheDocument();
    expect(screen.getByText('置信度 82%')).toBeInTheDocument();
    expect(screen.getByText('+22%')).toBeInTheDocument();
    expect(screen.getByText('待审批')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /查看建议/})).toHaveAttribute(
      'href',
      '/recommendations/rec-1',
    );
    // Focus object title is resolved through the object query.
    expect(
      await screen.findByRole('link', {name: 'Hanoi Circuit Works'}),
    ).toBeInTheDocument();
  });

  it('marks rule-based recommendations and degraded results', async () => {
    renderWithProviders(
      <RecommendationCard
        rec={{
          ...fx.recommendation,
          model: 'rules',
          degraded: true,
          status: 'Executed',
        }}
      />,
    );
    expect(await screen.findByText('规则')).toBeInTheDocument();
    expect(screen.queryByText('AI 建议')).not.toBeInTheDocument();
    expect(screen.getByText('降级')).toBeInTheDocument();
    expect(screen.getByText('已执行')).toBeInTheDocument();
  });
});
