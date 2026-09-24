/**
 * @fileoverview Realtime alert stream: severity-sorted list (≤ 200) with the
 * connection status, Open / All filter, links to the Object View, relative
 * times and an optimistic acknowledge for Operator+. Newly pushed alerts
 * flash their left bar once.
 */

import type {AlertDto} from '@ontodecide/situation/contract';
import {resolveText} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {BellRing, Check} from 'lucide-react';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useHasRole} from '../../../entities/session/store';
import {errorMessage} from '../../../shared/api/error_message';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {useOnline} from '../../../shared/lib/hooks';
import {Badge, SeverityBadge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Panel} from '../../../shared/ui/card';
import {EmptyState} from '../../../shared/ui/empty_state';
import {Tabs, TabsList, TabsTrigger} from '../../../shared/ui/tabs';
import {toast} from '../../../shared/ui/toast';
import {useUpdateAlert} from '../api';
import {sortAlertsBySeverity} from '../model';
import {useRealtimeStatus} from '../stream';
import {RealtimeBadge} from './realtime_badge';

const BAR: Record<AlertDto['severity'], string> = {
  CRITICAL: 'border-l-crit',
  HIGH: 'border-l-crit/70',
  MEDIUM: 'border-l-warn',
  LOW: 'border-l-blue',
};

type AlertFilterTab = 'open' | 'all';

/** Alert stream widget. */
export function AlertStream({
  alerts,
  readOnly,
  className,
}: {
  alerts: readonly AlertDto[];
  /** Wall mode: hides the acknowledge buttons and filter. */
  readOnly?: boolean;
  className?: string;
}) {
  const {t, i18n} = useTranslation('cockpit');
  const [tab, setTab] = useState<AlertFilterTab>('open');
  const canAck = useHasRole('Operator') && !readOnly;
  const online = useOnline();
  const newIds = useRealtimeStatus(s => s.newAlertIds);
  const update = useUpdateAlert();
  const sorted = useMemo(() => sortAlertsBySeverity(alerts), [alerts]);
  const openCount = sorted.filter(a => a.status === 'OPEN').length;
  const shown =
    tab === 'open' ? sorted.filter(a => a.status === 'OPEN') : sorted;
  const flash = new Set(newIds);

  const ack = (a: AlertDto) =>
    update.mutate(
      {id: a.id, status: 'ACKED'},
      {
        onSuccess: () => toast.success(t('alerts.acked')),
        onError: e => toast.error(t('alerts.ackFailed'), errorMessage(e, t)),
      },
    );

  return (
    <Panel
      title={t('alerts.title')}
      icon={<BellRing aria-hidden />}
      className={className}
      bodyClassName="flex flex-col gap-2"
      actions={
        <>
          <Badge tone={openCount ? 'crit' : 'neutral'} className="num">
            {t('alerts.count', {count: openCount})}
          </Badge>
          <RealtimeBadge />
        </>
      }
    >
      {!readOnly && (
        <Tabs value={tab} onValueChange={v => setTab(v as AlertFilterTab)}>
          <TabsList aria-label={t('alerts.filter')}>
            <TabsTrigger value="open">{t('alerts.filterOpen')}</TabsTrigger>
            <TabsTrigger value="all">{t('alerts.filterAll')}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {shown.length === 0 ? (
        <EmptyState
          icon={<Check aria-hidden />}
          title={tab === 'open' ? t('alerts.emptyOpen') : t('alerts.empty')}
          className="py-6"
        />
      ) : (
        <ul
          className="-mr-2 flex max-h-[26rem] min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2"
          aria-live="polite"
        >
          {shown.map(a => (
            <li
              key={a.id}
              data-testid="alert-item"
              className={cn(
                'rounded-[10px] border border-l-[3px] border-line bg-panel-2/60 px-3 py-2',
                BAR[a.severity],
                flash.has(a.id) && 'flash-bar',
                a.status !== 'OPEN' && 'opacity-75',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={a.severity} />
                    {a.rid ? (
                      <Link
                        to="/objects/rid/$rid"
                        params={{rid: a.rid}}
                        className="min-w-0 text-sm font-medium break-words text-text hover:text-cyan hover:underline"
                      >
                        {a.title}
                      </Link>
                    ) : (
                      <span
                        className="text-sm font-medium break-words text-text"
                        title={t('alerts.noObject')}
                      >
                        {a.title}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                    <span>
                      {resolveText(
                        a.automationName,
                        i18n.language,
                        a.automationId,
                      )}
                    </span>
                    <span aria-hidden className="text-dim">
                      ·
                    </span>
                    <time
                      dateTime={a.raisedAt}
                      title={fmt.dateTime(a.raisedAt)}
                    >
                      {fmt.ago(a.raisedAt)}
                    </time>
                    <span aria-hidden className="text-dim">
                      ·
                    </span>
                    <span className="num">
                      {t('alerts.hits', {count: a.hits})}
                    </span>
                    <span aria-hidden className="text-dim">
                      ·
                    </span>
                    <span data-testid="alert-status">
                      {t(`common:alertStatus.${a.status}`)}
                    </span>
                  </p>
                </div>
                {canAck && a.status === 'OPEN' && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={t('alerts.ackLabel', {title: a.title})}
                    disabled={
                      !online ||
                      (update.isPending && update.variables?.id === a.id)
                    }
                    onClick={() => ack(a)}
                  >
                    <Check aria-hidden />
                    {t('alerts.ack')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
