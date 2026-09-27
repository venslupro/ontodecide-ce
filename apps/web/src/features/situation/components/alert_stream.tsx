/**
 * @fileoverview 实时告警流: most severe first, live connection state, new
 * alerts flash once (left colour bar), click opens the Object View, OPEN
 * alerts can be acknowledged; 「全部」 lists every alert via `GET /alerts`
 * (cursor pages).
 */

import type {AlertDto} from '@ontodecide/situation/contract';
import {useNavigate} from '@tanstack/react-router';
import {ArrowRight, Check} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../../../shared/api/error_message';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {SeverityBadge, severityLevel} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';
import {useRealtimeStatus} from '../../../shared/ws';
import {useAckAlert, useAlerts} from '../api';
import {sortAlertsBySeverity} from '../model';

const BAR: Record<string, string> = {
  crit: 'bg-crit',
  warn: 'bg-warn',
  info: 'bg-cyan',
  good: 'bg-good',
};

function AlertRow({
  a,
  fresh,
  onOpen,
}: {
  a: AlertDto;
  fresh: boolean;
  onOpen(a: AlertDto): void;
}) {
  const {t} = useTranslation('cockpit');
  const ack = useAckAlert();
  return (
    <li className="relative flex items-center gap-3 border-b border-line py-2.5 pl-3 last:border-b-0">
      <span
        aria-hidden
        className={cn(
          'absolute top-2 bottom-2 left-0 w-1 rounded-full',
          BAR[severityLevel(a.severity)],
          fresh && 'animate-pulse',
        )}
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onOpen(a)}
        disabled={!a.rid}
      >
        <p className="truncate text-sm font-medium text-text">{a.title}</p>
        <p className="text-xs text-muted">
          {t('alerts.meta', {hits: a.hits, ago: fmt.ago(a.raisedAt)})}
          {a.status === 'ACKED' && ` · ${t('alerts.acked')}`}
        </p>
      </button>
      <SeverityBadge severity={a.severity} />
      {a.status === 'OPEN' && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('alerts.ack', {title: a.title})}
          title={t('alerts.ackShort')}
          loading={ack.isPending}
          onClick={() => ack.mutate(a.id)}
        >
          <Check aria-hidden />
        </Button>
      )}
      {ack.error ? (
        <span role="alert" className="sr-only">
          {errorMessage(ack.error, t)}
        </span>
      ) : null}
    </li>
  );
}

function AllAlertsDialog({
  open,
  onOpenChange,
  onOpen,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  onOpen(a: AlertDto): void;
}) {
  const {t} = useTranslation('cockpit');
  const q = useAlerts({}, 50, open);
  const items = q.data?.pages.flatMap(p => p.items) ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('alerts.all')} size="lg">
        <ul>
          {items.map(a => (
            <AlertRow key={a.id} a={a} fresh={false} onOpen={onOpen} />
          ))}
        </ul>
        {q.hasNextPage && (
          <Button
            className="mt-3"
            size="sm"
            loading={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {t('alerts.more')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Alert stream card body. */
export function AlertStream({alerts}: {alerts: readonly AlertDto[]}) {
  const {t} = useTranslation('cockpit');
  const navigate = useNavigate();
  const fresh = useRealtimeStatus(s => s.newAlertIds);
  const [all, setAll] = useState(false);
  const list = sortAlertsBySeverity(alerts.filter(a => a.status !== 'CLOSED'));
  const open = (a: AlertDto) => {
    setAll(false);
    if (a.rid) void navigate({to: '/objects/$rid', params: {rid: a.rid}});
  };
  return (
    <div className="flex flex-col">
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-dim">{t('alerts.none')}</p>
      ) : (
        <ul aria-live="polite" className="max-h-[340px] overflow-y-auto">
          {list.slice(0, 50).map(a => (
            <AlertRow
              key={a.id}
              a={a}
              fresh={fresh.includes(a.id)}
              onOpen={open}
            />
          ))}
        </ul>
      )}
      <Button
        variant="link"
        size="sm"
        className="mt-2 self-end"
        onClick={() => setAll(true)}
      >
        {t('alerts.all')}
        <ArrowRight aria-hidden />
      </Button>
      <AllAlertsDialog open={all} onOpenChange={setAll} onOpen={open} />
    </div>
  );
}
