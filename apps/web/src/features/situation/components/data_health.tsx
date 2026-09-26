/**
 * @fileoverview Data health per source: kind, quality score, last update
 * and last job status; stale sources get a warning badge (icon + text).
 */

import type {DataHealthDto} from '@ontodecide/integration/contract';
import {Database} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {fmt} from '../../../shared/lib/format';
import {Badge, StatusBadge, type StatusLevel} from '../../../shared/ui/badge';
import {Panel} from '../../../shared/ui/card';
import {EmptyState} from '../../../shared/ui/empty_state';
import {Progress} from '../../../shared/ui/progress';

const JOB_LEVEL: Record<string, StatusLevel> = {
  Succeeded: 'good',
  PartiallyFailed: 'warn',
  Failed: 'crit',
  Running: 'info',
  Queued: 'info',
};

/** Data health widget. */
export function DataHealth({
  sources,
  className,
}: {
  sources: readonly DataHealthDto[];
  className?: string;
}) {
  const {t} = useTranslation('cockpit');
  return (
    <Panel
      title={t('health.title')}
      icon={<Database aria-hidden />}
      className={className}
    >
      {sources.length === 0 ? (
        <EmptyState title={t('health.empty')} className="py-6" />
      ) : (
        <ul className="flex flex-col gap-3">
          {sources.map(s => {
            const q = s.qualityScore;
            const tone =
              q === null
                ? 'accent'
                : q >= 0.95
                  ? 'good'
                  : q >= 0.8
                    ? 'warn'
                    : 'crit';
            return (
              <li
                key={s.sourceId}
                data-testid="health-item"
                className="flex flex-col gap-1.5"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="min-w-0 truncate text-sm font-medium text-text"
                    title={s.name}
                  >
                    {s.name}
                  </span>
                  <Badge>
                    {t(`health.kinds.${s.kind}`, {defaultValue: s.kind})}
                  </Badge>
                  {!s.enabled && <Badge>{t('health.disabled')}</Badge>}
                  {s.stale && (
                    <StatusBadge level="warn">{t('health.stale')}</StatusBadge>
                  )}
                  {s.lastStatus && (
                    <StatusBadge
                      level={JOB_LEVEL[s.lastStatus] ?? 'info'}
                      className="ml-auto"
                    >
                      {t(`common:jobStatus.${s.lastStatus}`)}
                    </StatusBadge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Progress
                    value={q ?? 0}
                    tone={tone === 'accent' ? 'accent' : tone}
                    label={t('health.qualityLabel', {name: s.name})}
                    className="flex-1"
                  />
                  <span className="num w-12 text-right text-xs font-medium text-text">
                    {fmt.percent(q)}
                  </span>
                </div>
                <p
                  className={s.stale ? 'text-xs text-warn' : 'text-xs text-dim'}
                >
                  {s.lastJobAt ? (
                    <time
                      dateTime={s.lastJobAt}
                      title={fmt.dateTime(s.lastJobAt)}
                    >
                      {t('health.lastUpdate', {time: fmt.ago(s.lastJobAt)})}
                    </time>
                  ) : (
                    t('health.never')
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
