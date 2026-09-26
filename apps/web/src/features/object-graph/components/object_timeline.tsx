/**
 * @fileoverview Unified object timeline: executed actions, alerts,
 * recommendations focused on the object and property updates on one time
 * axis (newest first), with an icon per kind and relative + absolute time.
 */

import {resolveText} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {Bell, History, Lightbulb, Zap} from 'lucide-react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import type {UiActionType} from '../../../entities/schema/model';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {SeverityBadge} from '../../../shared/ui/badge';
import {EmptyState} from '../../../shared/ui/empty_state';
import type {TimelineEntry} from '../model';

const KIND_STYLE: Record<
  TimelineEntry['kind'],
  {icon: ReactNode; cls: string}
> = {
  action: {
    icon: <Zap aria-hidden />,
    cls: 'border-cyan/50 bg-cyan/10 text-cyan',
  },
  alert: {
    icon: <Bell aria-hidden />,
    cls: 'border-crit/50 bg-crit/10 text-crit',
  },
  recommendation: {
    icon: <Lightbulb aria-hidden />,
    cls: 'border-violet/50 bg-violet/10 text-violet',
  },
  update: {
    icon: <History aria-hidden />,
    cls: 'border-line-2 bg-panel-2 text-muted',
  },
};

/** Timeline list. */
export function ObjectTimeline({
  entries,
  actions,
}: {
  entries: readonly TimelineEntry[];
  actions: readonly UiActionType[];
}) {
  const {t, i18n} = useTranslation('objects');
  if (entries.length === 0)
    return <EmptyState title={t('view.timelineEmpty')} />;
  const actionName = (api: string) =>
    actions.find(a => a.apiName === api)?.displayName ?? api;
  return (
    <ol
      className="relative flex flex-col gap-3 border-l border-line-2 pl-5"
      aria-label={t('view.timeline')}
    >
      {entries.map(e => {
        const s = KIND_STYLE[e.kind];
        return (
          <li key={e.id} className="relative">
            <span
              className={cn(
                'absolute top-0.5 -left-[31px] flex size-5 items-center justify-center rounded-full border [&_svg]:size-3',
                s.cls,
              )}
            >
              {s.icon}
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-xs font-medium text-muted">
                {t(`view.kind.${e.kind}`)}
              </p>
              <time
                dateTime={e.at}
                title={fmt.dateTime(e.at)}
                className="text-[11px] text-dim"
              >
                {fmt.ago(e.at)} · {fmt.dateTime(e.at)}
              </time>
            </div>
            <div className="mt-0.5 text-sm text-text">
              {e.kind === 'action' && (
                <>
                  <span className="font-medium">
                    {actionName(e.log.actionType)}
                  </span>
                  <span className="text-muted">
                    {' '}
                    · {t('view.byActor', {actor: e.log.actor})}
                  </span>
                  {Object.keys(e.log.after).length > 0 && (
                    <p className="mt-0.5 font-mono text-[11px] break-all text-dim">
                      {Object.keys(e.log.after)
                        .filter(
                          k =>
                            JSON.stringify(e.log.before[k]) !==
                            JSON.stringify(e.log.after[k]),
                        )
                        .slice(0, 4)
                        .map(
                          k =>
                            `${k}: ${fmtVal(e.log.before[k])} → ${fmtVal(e.log.after[k])}`,
                        )
                        .join('; ')}
                    </p>
                  )}
                </>
              )}
              {e.kind === 'alert' && (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={e.alert.severity} />
                  <span>
                    {resolveText(
                      e.alert.automationName,
                      i18n.language,
                      e.alert.title,
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {t(`common:alertStatus.${e.alert.status}`)}
                  </span>
                </span>
              )}
              {e.kind === 'recommendation' && (
                <Link
                  to="/recommendations/$id"
                  params={{id: e.rec.id}}
                  className="text-cyan hover:underline"
                >
                  {e.rec.summary}
                </Link>
              )}
              {e.kind === 'update' && (
                <span className="text-muted">
                  {t('view.updatedVersion', {version: e.version})}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null) return '—';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
