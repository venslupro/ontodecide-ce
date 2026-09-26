/**
 * @fileoverview Outcome evaluation (效果评估) and small recommendation
 * helpers: locale normalization, expiry and case text.
 */

import type {RecommendationDto} from '../contract';
import {clamp} from './propagation';
import {round} from './simulation';

/** Outcome of an executed recommendation. */
export type Outcome = NonNullable<RecommendationDto['outcome']>;

/** Achievement = actual / expected, clamped to 0..2. */
export function computeOutcome(
  expected: number,
  actual: number,
  evaluatedAt: Date,
): Outcome {
  let achievement: number;
  if (Math.abs(expected) < 1e-9) achievement = Math.abs(actual) < 1e-9 ? 1 : 2;
  else achievement = clamp(actual / expected, 0, 2);
  return {
    expected: round(expected),
    actual: round(actual),
    achievement: round(achievement, 4),
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

/** Normalizes a requested locale to `zh-CN` or `en-US`. */
export function normalizeLocale(locale: string | undefined): 'zh-CN' | 'en-US' {
  return locale && /^en\b/i.test(locale) ? 'en-US' : 'zh-CN';
}

/** Whether a recommendation is past its expiry. */
export function isExpired(
  rec: Pick<RecommendationDto, 'expiresAt'>,
  now: Date,
): boolean {
  return new Date(rec.expiresAt).getTime() <= now.getTime();
}

/** Text stored for (and embedded from) an evaluated case. */
export function caseText(rec: RecommendationDto): string {
  const actions = rec.actions
    .map(a => `${a.actionType}(${a.target}) impact=${a.expectedImpact}`)
    .join('; ');
  const outcome = rec.outcome
    ? ` outcome: achievement=${rec.outcome.achievement} expected=${rec.outcome.expected} actual=${rec.outcome.actual}`
    : '';
  return `${rec.summary} | focus=${rec.focus} | actions: ${actions}${outcome}`;
}
