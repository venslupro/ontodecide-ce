/**
 * @fileoverview Impact heat graph (orange single hue, size = impact) plus a
 * ranked list of affected objects for a simulation result.
 */

import type {ScenarioResult} from '@ontodecide/decision/contract';
import {useNavigate} from '@tanstack/react-router';
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../../entities/schema/api';
import {useImpact} from '../../object-graph/api';
import {GraphView} from '../../../shared/graph/graph_view';
import {fmt} from '../../../shared/lib/format';
import {DegradedBadge} from '../../../shared/ui/badge';
import {EmptyState} from '../../../shared/ui/empty_state';
import {buildImpactGraph, rankAffected} from '../model';
import {ObjectLink} from './object_link';

/** Impact heat graph + ranked affected list. */
export function ImpactPanel({
  result,
  roots,
}: {
  result: ScenarioResult;
  roots: readonly string[];
}) {
  const {t} = useTranslation('scenarios');
  const navigate = useNavigate();
  const {model} = useUiModel();
  const impact = useImpact(roots[0], 3);
  const graph = useMemo(
    () => buildImpactGraph(result.affected, impact.data?.edges, roots),
    [result.affected, impact.data?.edges, roots],
  );
  const ranked = useMemo(
    () => rankAffected(result.affected),
    [result.affected],
  );
  const max = ranked.reduce((m, a) => Math.max(m, Math.abs(a.delta)), 0) || 1;

  if (result.affected.length === 0) {
    return <EmptyState title={t('impact.empty')} className="py-8" />;
  }

  return (
    <div className="grid grid-cols-12 gap-3.5">
      <div className="col-span-12 lg:col-span-7">
        {impact.data?.degraded && (
          <div className="mb-2">
            <DegradedBadge reason={t('impact.degraded')} />
          </div>
        )}
        <div className="overflow-hidden rounded-[10px] border border-line bg-panel-2/40">
          <GraphView
            nodes={graph.nodes}
            edges={graph.edges}
            mode="impact"
            height={340}
            onNodeClick={n => {
              if (!n.hidden)
                void navigate({to: '/objects/rid/$rid', params: {rid: n.id}});
            }}
            ariaLabel={t('impact.graphAria', {count: graph.nodes.length})}
          />
        </div>
        <p className="mt-2 flex items-center gap-2 text-xs text-dim">
          <span
            aria-hidden
            className="inline-block h-2 w-16 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--orange)_18%,transparent),var(--orange))]"
          />
          {t('impact.legend')}
        </p>
      </div>
      <div className="col-span-12 lg:col-span-5">
        <ol
          aria-label={t('impact.listTitle')}
          className="flex max-h-[380px] flex-col gap-1 overflow-y-auto pr-1"
        >
          {ranked.map((a, i) => (
            <li
              key={a.rid}
              className="rounded-lg px-2 py-1.5 hover:bg-panel-2/70"
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="w-4 shrink-0 text-right text-xs text-dim num">
                    {i + 1}
                  </span>
                  <ObjectLink
                    rid={a.rid}
                    title={a.title}
                    className="truncate"
                  />
                </span>
                <span
                  className={
                    a.delta < 0
                      ? 'shrink-0 text-crit num'
                      : 'shrink-0 text-good num'
                  }
                >
                  {fmt.signedPercent(a.delta)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-6">
                <span className="text-[11px] whitespace-nowrap text-dim">
                  {model.byName[a.type]?.displayName ?? a.type} ·{' '}
                  {t('impact.hop', {hop: a.hop})}
                </span>
                <span
                  className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-line-2"
                  aria-hidden
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-orange"
                    style={{width: `${(Math.abs(a.delta) / max) * 100}%`}}
                  />
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
