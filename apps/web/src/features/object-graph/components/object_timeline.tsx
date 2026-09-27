/**
 * @fileoverview Object timeline: imports (property provenance), actions
 * (from `GET /objects/{rid}/actions`, before → after), alerts and
 * recommendations on one time axis, newest first.
 */

import {useTranslation} from 'react-i18next';
import {resolveText} from '@ontodecide/shared-kernel';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {actionChanges, type TimelineEntry} from '../model';

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  return typeof v === 'number'
    ? fmt.number(v)
    : typeof v === 'string'
      ? v
      : JSON.stringify(v);
}

const DOT: Record<TimelineEntry['kind'], string> = {
  import: 'bg-blue',
  action: 'bg-violet',
  alert: 'bg-crit',
  recommendation: 'bg-cyan',
};

/** Timeline list. */
export function ObjectTimeline({entries}: {entries: readonly TimelineEntry[]}) {
  const {t, i18n} = useTranslation('objects');
  if (!entries.length)
    return <p className="text-sm text-dim">{t('timeline.empty')}</p>;
  const text = (e: TimelineEntry): string => {
    switch (e.kind) {
      case 'import':
        return t('timeline.import', {prop: e.prop, job: e.jobId, row: e.row});
      case 'action': {
        const ch = actionChanges(e.log)
          .map(c => `${c.prop} ${show(c.before)} → ${show(c.after)}`)
          .join('，');
        return t('timeline.action', {
          action: e.log.actionType,
          actor: t(
            `timeline.actor.${e.log.actor.startsWith('svc:') ? 'system' : e.log.actor}`,
            {
              defaultValue: e.log.actor,
            },
          ),
          changes: ch || '—',
        });
      }
      case 'alert':
        return t('timeline.alert', {
          name: resolveText(e.alert.automationName, i18n.language),
          title: e.alert.title,
        });
      case 'recommendation':
        return t('timeline.recommendation', {summary: e.rec.summary});
    }
  };
  return (
    <ol className="flex flex-col" aria-label={t('timeline.title')}>
      {entries.map((e, i) => (
        <li
          key={`${e.kind}-${i}`}
          className="flex items-start gap-3 border-b border-line py-2 text-sm last:border-b-0"
        >
          <time
            className="num w-24 shrink-0 text-xs text-muted"
            dateTime={new Date(e.at).toISOString()}
            title={fmt.dateTime(e.at)}
          >
            {fmt.time(e.at)}
          </time>
          <span
            aria-hidden
            className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[e.kind])}
          />
          <span className="sr-only">{t(`timeline.kind.${e.kind}`)}</span>
          <span className="min-w-0 break-words text-text">{text(e)}</span>
        </li>
      ))}
    </ol>
  );
}
