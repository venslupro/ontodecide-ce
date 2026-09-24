/**
 * @fileoverview Pending (Proposed) recommendations with AI marker,
 * confidence, expected impact, degraded marker and a link to the
 * recommendation center.
 */

import type {RecommendationSummary} from '@ontodecide/situation/contract';
import {Link} from '@tanstack/react-router';
import {ChevronRight, Lightbulb} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {AiBadge, Badge, DegradedBadge} from '../../../shared/ui/badge';
import {Panel} from '../../../shared/ui/card';
import {EmptyState} from '../../../shared/ui/empty_state';

/** Pending recommendations widget. */
export function PendingRecommendations({
  recommendations,
  readOnly,
  className,
}: {
  recommendations: readonly RecommendationSummary[];
  /** Wall mode: no links. */
  readOnly?: boolean;
  className?: string;
}) {
  const {t} = useTranslation('cockpit');
  const list = recommendations
    .filter(r => r.status === 'Proposed')
    .sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
  return (
    <Panel
      title={t('recs.title')}
      icon={<Lightbulb aria-hidden />}
      className={className}
      actions={
        list.length > 0 && (
          <Badge tone="violet" className="num">
            {list.length}
          </Badge>
        )
      }
    >
      {list.length === 0 ? (
        <EmptyState title={t('recs.empty')} className="py-6" />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map(r => (
            <li
              key={r.id}
              data-testid="rec-item"
              className="rounded-[10px] border border-line bg-panel-2/60 px-3 py-2.5"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <AiBadge />
                {r.degraded && <DegradedBadge />}
                <span className="ml-auto text-xs text-dim">
                  <time
                    dateTime={r.createdAt}
                    title={fmt.dateTime(r.createdAt)}
                  >
                    {fmt.ago(r.createdAt)}
                  </time>
                </span>
              </div>
              <p className="text-sm leading-5 break-words text-text">
                {r.summary}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="num text-muted">
                  {t('recs.confidence', {value: fmt.percent(r.confidence)})}
                </span>
                <span
                  className={cn(
                    'num font-medium',
                    r.expectedImpact >= 0 ? 'text-cyan' : 'text-orange',
                  )}
                >
                  {t('recs.impact', {
                    value: fmt.signedPercent(r.expectedImpact),
                  })}
                </span>
                {!readOnly && (
                  <Link
                    to="/recommendations/$id"
                    params={{id: r.id}}
                    aria-label={t('recs.viewLabel', {summary: r.summary})}
                    className="ml-auto inline-flex items-center gap-0.5 font-medium whitespace-nowrap text-cyan hover:underline"
                  >
                    {t('recs.view')}
                    <ChevronRight className="size-3.5" aria-hidden />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
