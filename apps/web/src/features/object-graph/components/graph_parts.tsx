/**
 * @fileoverview Small graph companions: a legend by object type color and
 * an accessible neighbor list grouped by link type (fallback for the
 * canvas graph).
 */

import {Link} from '@tanstack/react-router';
import {ArrowLeft, ArrowRight} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {UiModel} from '../../../entities/schema/model';
import type {GNode} from '../../../shared/graph/limit';
import type {NeighborGroup} from '../model';
import {TypeDot} from './type_icon';

/** Legend of the object types present in a graph. */
export function GraphLegend({
  nodes,
  model,
}: {
  nodes: readonly GNode[];
  model: UiModel;
}) {
  const {t} = useTranslation('objects');
  const order = model.types.map(x => x.apiName);
  const types = [
    ...new Set(nodes.filter(n => !n.hidden).map(n => n.type)),
  ].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  if (types.length === 0) return null;
  return (
    <ul
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"
      aria-label={t('graph.legend')}
    >
      {types.map(ty => (
        <li key={ty} className="inline-flex items-center gap-1.5">
          <TypeDot type={ty} order={order} />
          {model.byName[ty]?.displayName ?? ty}
          <span className="num text-dim">
            {nodes.filter(n => n.type === ty && !n.hidden).length}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Direct neighbors grouped by link type (accessible alternative to the graph). */
export function NeighborList({
  groups,
  model,
}: {
  groups: readonly NeighborGroup[];
  model: UiModel;
}) {
  const {t} = useTranslation('objects');
  const order = model.types.map(x => x.apiName);
  if (groups.length === 0)
    return <p className="text-xs text-dim">{t('view.noNeighbors')}</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map(g => {
        const link = model.links.find(l => l.apiName === g.linkType);
        return (
          <section
            key={`${g.linkType}:${g.direction}`}
            aria-label={link?.displayName ?? g.linkType}
          >
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              {g.direction === 'out' ? (
                <ArrowRight className="size-3" aria-hidden />
              ) : (
                <ArrowLeft className="size-3" aria-hidden />
              )}
              {link?.displayName ?? g.linkType}
              <span className="text-dim">
                (
                {g.direction === 'out'
                  ? t('view.outgoing')
                  : t('view.incoming')}
                )
              </span>
              <span className="num text-dim">{g.items.length}</span>
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {g.items.map(n => (
                <li key={n.rid}>
                  <Link
                    to="/objects/rid/$rid"
                    params={{rid: n.rid}}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-panel-2 px-2 py-0.5 text-xs text-text hover:border-cyan/60 hover:text-cyan"
                  >
                    <TypeDot type={n.type} order={order} className="size-2" />
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
