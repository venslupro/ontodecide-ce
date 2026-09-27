/**
 * @fileoverview 待确认建议 on the cockpit: summary, expected impact,
 * confidence and the 「AI 排序 / 规则排序」 badge; 「确认」 opens the
 * confirmation dialog directly, 「查看」 goes to the recommendation center.
 */

import {Link} from '@tanstack/react-router';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {fmt} from '../../../shared/lib/format';
import {Button} from '../../../shared/ui/button';
import {ConfirmRecommendationDialog} from '../../decision/components/confirm_dialog';
import {RankedByBadge} from '../../decision/components/ranked_by_badge';
import {recImpact, type PendingRec} from '../model';

/** Pending recommendations list. */
export function PendingRecommendations({recs}: {recs: readonly PendingRec[]}) {
  const {t} = useTranslation('cockpit');
  const [confirm, setConfirm] = useState<PendingRec>();
  if (!recs.length)
    return (
      <p className="py-6 text-center text-sm text-dim">{t('pending.none')}</p>
    );
  return (
    <>
      <ul className="flex flex-col">
        {recs.slice(0, 5).map(r => {
          const impact = recImpact(r);
          return (
            <li
              key={r.id}
              className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to="/recommendations/$id"
                  params={{id: r.id}}
                  className="block truncate text-sm font-medium text-text hover:text-cyan"
                >
                  {r.summary}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {impact !== null && (
                    <span>
                      {t('pending.impact', {
                        value: fmt.signedPercent(impact, 0),
                      })}
                    </span>
                  )}
                  <span>
                    ·{' '}
                    {t('pending.confidence', {
                      value: fmt.number(r.confidence, {
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </span>
                  <RankedByBadge rankedBy={r.rankedBy} model={r.model} />
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" asChild>
                  <Link to="/recommendations/$id" params={{id: r.id}}>
                    {t('pending.view')}
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setConfirm(r)}
                >
                  {t('pending.confirm')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {confirm && (
        <ConfirmRecommendationDialog
          recommendation={confirm}
          open={!!confirm}
          onOpenChange={o => !o && setConfirm(undefined)}
          onDone={() => setConfirm(undefined)}
        />
      )}
    </>
  );
}
