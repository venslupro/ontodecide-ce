/**
 * @fileoverview Dead-letter queue panel: queue filter, per-queue counts with
 * "replay all", selectable rows (id, queue, attempts, received, collapsible
 * body preview, replayed time) and "replay selected", each with a confirm.
 */

import type {DeadLetterDto} from '@ontodecide/situation/contract';
import {Inbox, RotateCcw} from 'lucide-react';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {
  useDeadLetters,
  useReplayDeadLetters,
} from '../../features/situation/api';
import {errorMessage} from '../../shared/api/error_message';
import {fmt} from '../../shared/lib/format';
import {useOnline} from '../../shared/lib/hooks';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Checkbox} from '../../shared/ui/input';
import {Mono} from '../../shared/ui/page_header';
import {NativeSelect} from '../../shared/ui/select';
import {Skeleton} from '../../shared/ui/skeleton';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';
import {toast} from '../../shared/ui/toast';
import {ConfirmDialog} from './confirm_dialog';

function preview(body: unknown): {short: string; full: string} {
  let full: string;
  try {
    full = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  } catch {
    full = String(body);
  }
  const flat = full.replace(/\s+/g, ' ');
  return {full, short: flat.length > 64 ? `${flat.slice(0, 64)}…` : flat};
}

type Pending =
  | {kind: 'selected'; groups: Map<string, string[]>; count: number}
  | {kind: 'all'; queue: string; count: number};

/** Dead-letter panel. */
export function DeadLetterPanel() {
  const {t} = useTranslation('admin');
  const online = useOnline();
  const [queue, setQueue] = useState('');
  const all = useDeadLetters();
  const list = useDeadLetters(queue || undefined);
  const replay = useReplayDeadLetters();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of all.data ?? []) m.set(d.queue, (m.get(d.queue) ?? 0) + 1);
    return m;
  }, [all.data]);
  const queues = [...counts.keys()].sort();
  const visibleSelected = rows.filter(r => selected.has(r.id));
  const allChecked = rows.length > 0 && visibleSelected.length === rows.length;

  const toggle = (id: string, on: boolean) =>
    setSelected(s => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const askSelected = () => {
    const groups = new Map<string, string[]>();
    for (const d of visibleSelected)
      groups.set(d.queue, [...(groups.get(d.queue) ?? []), d.id]);
    setPending({kind: 'selected', groups, count: visibleSelected.length});
  };

  const run = async () => {
    if (!pending) return;
    try {
      let replayed = 0;
      if (pending.kind === 'all') {
        replayed = (await replay.mutateAsync({queue: pending.queue})).replayed;
      } else {
        for (const [q, ids] of pending.groups)
          replayed += (await replay.mutateAsync({queue: q, ids})).replayed;
      }
      toast.success(t('dlq.replayed', {count: replayed}));
      setSelected(new Set());
      setPending(null);
    } catch (e) {
      toast.error(t('dlq.replayFailed'), errorMessage(e, t));
    }
  };

  return (
    <Panel
      title={t('dlq.title')}
      subtitle={t('dlq.subtitle')}
      icon={<Inbox aria-hidden />}
      bodyClassName="px-0"
      actions={
        <>
          <NativeSelect
            size="sm"
            className="w-48"
            aria-label={t('dlq.queueFilter')}
            placeholder={t('dlq.allQueues')}
            options={queues.map(q => ({
              value: q,
              label: `${q} (${counts.get(q)})`,
            }))}
            value={queue}
            onChange={e => {
              setQueue(e.target.value);
              setSelected(new Set());
            }}
          />
          <Button
            size="sm"
            disabled={!online || visibleSelected.length === 0}
            onClick={askSelected}
          >
            <RotateCcw aria-hidden />
            {t('dlq.replaySelected', {count: visibleSelected.length})}
          </Button>
        </>
      }
    >
      {queues.length > 0 && (
        <ul
          className="mb-3 flex flex-wrap gap-2 px-4"
          aria-label={t('dlq.queues')}
        >
          {queues.map(q => (
            <li
              key={q}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/40 py-1 pr-1 pl-2.5 text-xs"
            >
              <Mono className="text-text">{q}</Mono>
              <Badge tone="warn">{counts.get(q)}</Badge>
              <Button
                size="sm"
                variant="ghost"
                disabled={!online}
                aria-label={t('dlq.replayAllAria', {queue: q})}
                onClick={() =>
                  setPending({kind: 'all', queue: q, count: counts.get(q) ?? 0})
                }
              >
                {t('dlq.replayAll')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.isLoading && (
        <div className="flex flex-col gap-2 px-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      )}
      {list.isError && (
        <ErrorView
          detail={errorMessage(list.error, t)}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.data && rows.length === 0 && (
        <EmptyState title={t('dlq.empty')} description={t('dlq.emptyHint')} />
      )}
      {rows.length > 0 && (
        <Table aria-label={t('dlq.title')}>
          <THead>
            <tr className="border-b border-line">
              <Th className="w-10 pl-4">
                <Checkbox
                  aria-label={t('dlq.selectAll')}
                  checked={
                    allChecked
                      ? true
                      : visibleSelected.length
                        ? 'indeterminate'
                        : false
                  }
                  onCheckedChange={v =>
                    setSelected(
                      v === true ? new Set(rows.map(r => r.id)) : new Set(),
                    )
                  }
                />
              </Th>
              <Th>{t('dlq.id')}</Th>
              <Th>{t('dlq.queue')}</Th>
              <Th className="text-right">{t('dlq.attempts')}</Th>
              <Th>{t('dlq.receivedAt')}</Th>
              <Th>{t('dlq.body')}</Th>
              <Th className="pr-4">{t('dlq.replayedAt')}</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((d: DeadLetterDto) => {
              const p = preview(d.body);
              return (
                <Tr key={d.id} className="align-top">
                  <Td className="pl-4">
                    <Checkbox
                      aria-label={t('dlq.select', {id: d.id})}
                      checked={selected.has(d.id)}
                      onCheckedChange={v => toggle(d.id, v === true)}
                    />
                  </Td>
                  <Td>
                    <Mono className="text-text">{d.id}</Mono>
                  </Td>
                  <Td>
                    <Mono>{d.queue}</Mono>
                  </Td>
                  <Td className="num text-right">{d.attempts}</Td>
                  <Td className="whitespace-nowrap text-muted">
                    {fmt.dateTime(d.receivedAt)}
                  </Td>
                  <Td className="max-w-md">
                    <details>
                      <summary className="cursor-pointer truncate font-mono text-xs text-muted hover:text-text">
                        {p.short}
                      </summary>
                      <pre className="mt-1.5 max-h-60 overflow-auto rounded-md border border-line bg-panel-2 p-2 font-mono text-xs text-text">
                        {p.full}
                      </pre>
                    </details>
                  </Td>
                  <Td className="pr-4 whitespace-nowrap">
                    {d.replayedAt ? (
                      <span className="text-muted">
                        {fmt.dateTime(d.replayedAt)}
                      </span>
                    ) : (
                      <span className="text-xs text-dim">
                        {t('dlq.notReplayed')}
                      </span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={o => !o && !replay.isPending && setPending(null)}
        title={
          pending?.kind === 'all'
            ? t('dlq.confirmAllTitle', {
                queue: pending.queue,
                count: pending.count,
              })
            : t('dlq.confirmSelectedTitle', {count: pending?.count ?? 0})
        }
        description={t('dlq.confirmDescription')}
        confirmLabel={t('dlq.confirm')}
        loading={replay.isPending}
        disabled={!online}
        onConfirm={() => void run()}
      />
    </Panel>
  );
}
