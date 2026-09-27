/**
 * @fileoverview Cockpit realtime integration: registers the recommendation
 * merger with the shared stream (`shared/ws`) while the cockpit is mounted.
 * The shared stream already batches frames (≤ 1 render per second) and
 * merges KPI / alert / snapshot frames into every `['situation',
 * 'overview', …]` query.
 */

import type {QueryClient} from '@tanstack/react-query';
import {useEffect} from 'react';
import {registerStreamMerger, type WsFrame} from '../../shared/ws';
import {situationKeys} from './api';
import {mergeRecommendationFrames, type OverviewView} from './model';

/** Merger writing `recommendation` frames into the overview caches. */
export function recommendationMerger(qc: QueryClient, frames: WsFrame[]): void {
  if (!frames.some(f => f.type === 'recommendation')) return;
  for (const [key, value] of qc.getQueriesData<OverviewView>({
    queryKey: situationKeys.overviewAll(),
  })) {
    const next = mergeRecommendationFrames(value, frames);
    if (next && next !== value) qc.setQueryData(key, next);
  }
}

/** Registers {@link recommendationMerger} for the component's lifetime. */
export function useRecommendationMerger(): void {
  useEffect(() => registerStreamMerger(recommendationMerger), []);
}
