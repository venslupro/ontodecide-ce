/**
 * @fileoverview Recommendation card for the recommendation center list:
 * summary (AI-marked), status, confidence, top action impact, focus object,
 * created / expiry times and the degraded marker.
 */

import type {RecommendationDto} from '@ontodecide/decision/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {
  ArrowRight,
  Clock,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {DegradedBadge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {topAction} from '../model';
import {ObjectLink} from './object_link';
import {RecSourceBadge, RecStatusBadge} from './rec_status_badge';

/** One recommendation in the list. */
export function RecommendationCard({
  rec,
  className,
}: {
  rec: RecommendationDto;
  className?: string;
}) {
  const {t, i18n} = useTranslation('recommendations');
  const {model} = useUiModel();
  const top = topAction(rec);
  const topName = top
    ? resolveText(
        top.displayName,
        i18n.language,
        model.actions.find(a => a.apiName === top.actionType)?.displayName ??
          top.actionType,
      )
    : undefined;
  const expired = new Date(rec.expiresAt).getTime() <= Date.now();
  const summaryId = `rec-${rec.id}-summary`;

  return (
    <article
      aria-labelledby={summaryId}
      className={cn('glass flex flex-col gap-3 p-4', className)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <RecStatusBadge status={rec.status} />
        <RecSourceBadge model={rec.model} />
        {rec.degraded && <DegradedBadge reason={t('degradedHint')} />}
        <span className="ml-auto text-xs text-muted num">
          {t('confidence', {value: rec.confidence})}
        </span>
      </div>

      <h3
        id={summaryId}
        className="text-sm leading-6 font-medium text-text break-words"
      >
        {rec.summary || t('noSummary')}
      </h3>

      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        {top && (
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="whitespace-nowrap text-muted">{t('topAction')}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="truncate text-text">{topName}</span>
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 num font-medium',
                  top.expectedImpact >= 0 ? 'text-good' : 'text-crit',
                )}
              >
                {top.expectedImpact >= 0 ? (
                  <TrendingUp className="size-3.5" aria-hidden />
                ) : (
                  <TrendingDown className="size-3.5" aria-hidden />
                )}
                {fmt.signedPercent(top.expectedImpact)}
              </span>
            </dd>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="flex items-center gap-1 whitespace-nowrap text-muted">
            <Target className="size-3.5" aria-hidden />
            {t('focus')}
          </dt>
          <dd className="min-w-0 truncate">
            <ObjectLink rid={rec.focus} />
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            <time dateTime={rec.createdAt} title={fmt.dateTime(rec.createdAt)}>
              {t('createdAgo', {time: fmt.ago(rec.createdAt)})}
            </time>
          </span>
          {rec.status === 'Proposed' && (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                expired && 'text-crit',
              )}
            >
              <Clock className="size-3.5" aria-hidden />
              <time
                dateTime={rec.expiresAt}
                title={fmt.dateTime(rec.expiresAt)}
              >
                {expired
                  ? t('expiredAt', {time: fmt.ago(rec.expiresAt)})
                  : t('expiresIn', {time: fmt.ago(rec.expiresAt)})}
              </time>
            </span>
          )}
        </span>
        <Button asChild size="sm" variant="ghost">
          <Link
            to="/recommendations/$id"
            params={{id: rec.id}}
            aria-label={t('viewAria', {summary: rec.summary})}
          >
            {t('common:actions.view')}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </article>
  );
}
