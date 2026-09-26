/**
 * @fileoverview /sources (Operator): data sources with kind, target type,
 * enabled / paused state, last job status and quality (data health), and
 * each source's jobs (expandable, linking to /jobs/$id). Modelers can
 * create, enable/disable and delete sources.
 */

import type {DataHealthDto, SourceDto} from '@ontodecide/integration/contract';
import {Link} from '@tanstack/react-router';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  FileSpreadsheet,
  Globe,
  PauseCircle,
  Plus,
  Trash2,
  Webhook,
} from 'lucide-react';
import {Fragment, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../entities/schema/api';
import {useHasRole} from '../../entities/session/store';
import {errorMessage} from '../../shared/api/error_message';
import {fmt} from '../../shared/lib/format';
import {useOnline} from '../../shared/lib/hooks';
import {Badge, StatusBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card} from '../../shared/ui/card';
import {Dialog, DialogClose, DialogContent} from '../../shared/ui/dialog';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {Switch} from '../../shared/ui/switch';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';
import {toast} from '../../shared/ui/toast';
import {Tooltip} from '../../shared/ui/tooltip';
import {
  useDataHealth,
  useDeleteSource,
  useJobs,
  useSources,
  useUpdateSource,
} from '../../features/integration/api';
import {
  JobStatusBadge,
  qualityTone,
} from '../../features/integration/components/job_status_badge';

const KIND_ICON: Record<SourceDto['kind'], ReactNode> = {
  file: <FileSpreadsheet aria-hidden />,
  rest: <Globe aria-hidden />,
  webhook: <Webhook aria-hidden />,
};

/** Jobs of one source (loaded when the row is expanded). */
function SourceJobs({sourceId, colSpan}: {sourceId: string; colSpan: number}) {
  const {t} = useTranslation('sources');
  const jobs = useJobs(sourceId);
  const list = (jobs.data ?? [])
    .filter(j => j.sourceId === sourceId)
    .slice(0, 10);
  return (
    <Tr className="hover:bg-transparent">
      <Td colSpan={colSpan} className="bg-panel-2/40 px-6 py-3">
        {jobs.isLoading ? (
          <Skeleton className="h-6 w-full" />
        ) : jobs.error ? (
          <p className="text-xs text-crit">{errorMessage(jobs.error, t)}</p>
        ) : list.length === 0 ? (
          <p className="text-xs text-dim">{t('list.jobs.empty')}</p>
        ) : (
          <ul
            aria-label={t('list.jobs.title')}
            className="flex flex-col divide-y divide-line"
          >
            {list.map(j => (
              <li
                key={j.id}
                className="flex flex-wrap items-center gap-3 py-1.5 text-xs"
              >
                <Link
                  to="/jobs/$id"
                  params={{id: j.id}}
                  className="font-mono text-cyan hover:underline"
                >
                  {j.id}
                </Link>
                <JobStatusBadge status={j.status} />
                <span className="text-muted">{t(`list.txn.${j.txnType}`)}</span>
                <span className="num text-muted">
                  {t('list.jobs.counts', {
                    received: j.received,
                    upserted: j.upserted,
                    rejected: j.rejected,
                  })}
                </span>
                <Badge tone={qualityTone(j.qualityScore)}>
                  {t('list.quality', {value: fmt.percent(j.qualityScore)})}
                </Badge>
                <span className="ml-auto flex items-center gap-1 text-dim">
                  <Clock className="size-3" aria-hidden />
                  {fmt.dateTime(j.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Td>
    </Tr>
  );
}

/** State badge of a source. */
function SourceState({
  source,
  health,
}: {
  source: SourceDto;
  health?: DataHealthDto;
}) {
  const {t} = useTranslation('sources');
  return (
    <div className="flex flex-wrap items-center gap-1">
      {source.paused ? (
        <Tooltip content={t('list.state.pausedHint')}>
          <span>
            <Badge tone="warn">
              <PauseCircle aria-hidden />
              {t('list.state.paused')}
            </Badge>
          </span>
        </Tooltip>
      ) : source.enabled ? (
        <StatusBadge level="good">{t('list.state.enabled')}</StatusBadge>
      ) : (
        <Badge tone="neutral">{t('list.state.disabled')}</Badge>
      )}
      {health?.stale && (
        <StatusBadge level="warn">{t('list.state.stale')}</StatusBadge>
      )}
    </div>
  );
}

/** The data sources page. */
export function SourceListPage() {
  const {t} = useTranslation('sources');
  const isModeler = useHasRole('Modeler');
  const online = useOnline();
  const {model} = useUiModel();
  const sources = useSources();
  const health = useDataHealth();
  const update = useUpdateSource();
  const del = useDeleteSource();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<SourceDto | null>(null);

  const healthById = new Map((health.data ?? []).map(h => [h.sourceId, h]));
  const list = sources.data ?? [];
  const cols = isModeler ? 8 : 7;

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await del.mutateAsync(toDelete.id);
      toast.success(t('list.delete.done', {name: toDelete.name}));
      setToDelete(null);
    } catch (e) {
      toast.error(t('list.delete.failed'), errorMessage(e, t));
    }
  };

  const setEnabled = async (s: SourceDto, enabled: boolean) => {
    try {
      await update.mutateAsync({id: s.id, patch: {enabled}});
    } catch (e) {
      toast.error(errorMessage(e, t));
    }
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={
          isModeler && (
            <Button variant="primary" asChild>
              <Link to="/sources/new">
                <Plus aria-hidden />
                {t('list.newSource')}
              </Link>
            </Button>
          )
        }
      />

      <Card className="overflow-hidden">
        {sources.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : sources.error ? (
          <ErrorView
            detail={errorMessage(sources.error, t)}
            onRetry={() => void sources.refetch()}
          />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Database aria-hidden />}
            title={t('list.empty')}
            description={t('list.emptyHint')}
            action={
              isModeler && (
                <Button asChild>
                  <Link to="/sources/new">
                    <Plus aria-hidden />
                    {t('list.newSource')}
                  </Link>
                </Button>
              )
            }
          />
        ) : (
          <Table aria-label={t('list.title')}>
            <THead>
              <tr>
                <Th className="w-8" />
                <Th>{t('list.cols.name')}</Th>
                <Th>{t('list.cols.kind')}</Th>
                <Th>{t('list.cols.target')}</Th>
                <Th>{t('list.cols.state')}</Th>
                <Th>{t('list.cols.lastJob')}</Th>
                <Th>{t('list.cols.quality')}</Th>
                {isModeler && (
                  <Th className="text-right">{t('list.cols.actions')}</Th>
                )}
              </tr>
            </THead>
            <TBody>
              {list.map(s => {
                const h = healthById.get(s.id);
                const open = expanded.has(s.id);
                const typeName =
                  model.byName[s.mapping?.targetType]?.displayName ??
                  s.mapping?.targetType;
                const quality = h?.qualityScore ?? null;
                return (
                  <Fragment key={s.id}>
                    <Tr>
                      <Td>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-expanded={open}
                          aria-label={
                            open
                              ? t('list.jobs.hide', {name: s.name})
                              : t('list.jobs.show', {name: s.name})
                          }
                          onClick={() => toggle(s.id)}
                        >
                          {open ? (
                            <ChevronDown aria-hidden />
                          ) : (
                            <ChevronRight aria-hidden />
                          )}
                        </Button>
                      </Td>
                      <Td>
                        <div className="font-medium text-text">{s.name}</div>
                        <Mono className="text-[11px] text-dim">{s.id}</Mono>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted [&_svg]:size-3.5">
                          {KIND_ICON[s.kind]}
                          {t(`kinds.${s.kind}.title`)}
                        </span>
                      </Td>
                      <Td className="text-sm">{typeName}</Td>
                      <Td>
                        <SourceState source={s} health={h} />
                      </Td>
                      <Td>
                        {h?.lastStatus ? (
                          <div className="flex flex-col gap-0.5">
                            <JobStatusBadge status={h.lastStatus} />
                            {h.lastJobAt && (
                              <span className="text-[11px] text-dim">
                                {fmt.ago(h.lastJobAt)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-dim">
                            {t('list.never')}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {quality === null ? (
                          <span className="text-xs text-dim">—</span>
                        ) : (
                          <Badge tone={qualityTone(quality)} className="num">
                            {fmt.percent(quality, 1)}
                          </Badge>
                        )}
                      </Td>
                      {isModeler && (
                        <Td className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Switch
                              checked={s.enabled}
                              disabled={
                                !online || update.isPending || !!s.paused
                              }
                              aria-label={
                                s.enabled
                                  ? t('list.toggle.disable', {name: s.name})
                                  : t('list.toggle.enable', {name: s.name})
                              }
                              onCheckedChange={c => void setEnabled(s, c)}
                            />
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={!online}
                              aria-label={t('list.delete.label', {
                                name: s.name,
                              })}
                              onClick={() => setToDelete(s)}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </div>
                        </Td>
                      )}
                    </Tr>
                    {open && <SourceJobs sourceId={s.id} colSpan={cols} />}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!toDelete} onOpenChange={o => !o && setToDelete(null)}>
        {toDelete && (
          <DialogContent
            size="sm"
            title={t('list.delete.title')}
            description={t('list.delete.body', {name: toDelete.name})}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="ghost">{t('common:actions.cancel')}</Button>
                </DialogClose>
                <Button
                  variant="danger"
                  loading={del.isPending}
                  onClick={() => void confirmDelete()}
                >
                  <Trash2 aria-hidden />
                  {t('list.delete.confirm')}
                </Button>
              </>
            }
          />
        )}
      </Dialog>
    </div>
  );
}
