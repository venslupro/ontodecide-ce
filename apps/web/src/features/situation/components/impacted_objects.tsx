/**
 * @fileoverview Objects most affected by the latest recommendation's
 * simulation (sorted by |delta|), with an orange single-hue impact bar.
 */

import type {RecommendationSummary} from '@ontodecide/situation/contract';
import {Link} from '@tanstack/react-router';
import {Waypoints} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import {impactColor, useChartTokens} from '../../../shared/charts/theme';
import {fmt} from '../../../shared/lib/format';
import {DegradedBadge} from '../../../shared/ui/badge';
import {Panel} from '../../../shared/ui/card';
import {EmptyState, ErrorView} from '../../../shared/ui/empty_state';
import {Skeleton} from '../../../shared/ui/skeleton';
import {useRecommendation} from '../../decision/api';
import {newestProposed} from '../model';

const MAX_ROWS = 8;

/** Impacted objects widget. */
export function ImpactedObjects({
  recommendations,
  className,
}: {
  recommendations: readonly RecommendationSummary[];
  className?: string;
}) {
  const {t} = useTranslation('cockpit');
  const tokens = useChartTokens();
  const {model} = useUiModel();
  const latest = newestProposed(recommendations);
  const q = useRecommendation(latest?.id);
  const sim = q.data?.simulation;
  const rows = [...(sim?.affected ?? [])]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MAX_ROWS);
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.delta)), 0) || 1;

  return (
    <Panel
      title={t('impacted.title')}
      subtitle={rows.length > 0 ? t('impacted.subtitle') : undefined}
      icon={<Waypoints aria-hidden />}
      className={className}
      actions={sim?.degraded && <DegradedBadge />}
    >
      {latest && q.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({length: 4}, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : latest && q.isError ? (
        <ErrorView onRetry={() => void q.refetch()} className="py-6" />
      ) : rows.length === 0 ? (
        <EmptyState title={t('impacted.empty')} className="py-6" />
      ) : (
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th>{t('impacted.col.object')}</th>
              <th>{t('impacted.col.type')}</th>
              <th>{t('impacted.col.hop')}</th>
              <th>{t('impacted.col.delta')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const k = Math.abs(r.delta) / max;
              return (
                <tr key={r.rid} className="border-b border-line last:border-0">
                  <td className="max-w-0 py-1.5 pr-2">
                    <Link
                      to="/objects/rid/$rid"
                      params={{rid: r.rid}}
                      className="block truncate font-medium text-text hover:text-cyan hover:underline"
                      title={r.title}
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2 text-xs whitespace-nowrap text-muted">
                    {model.byName[r.type]?.displayName ?? r.type}
                  </td>
                  <td className="py-1.5 pr-2 text-xs whitespace-nowrap text-dim">
                    {t('impacted.hop', {hop: r.hop})}
                  </td>
                  <td className="w-[38%] py-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
                        aria-hidden
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(4, k * 100)}%`,
                            background: impactColor(k, tokens.orange),
                          }}
                        />
                      </div>
                      <span className="num w-14 text-right text-xs font-medium text-orange">
                        {fmt.signedPercent(r.delta, 0)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
