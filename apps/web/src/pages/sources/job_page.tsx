/**
 * @fileoverview /jobs/$id (Operator): ingestion job progress — status,
 * message-group progress, counters (received / upserted / merged / skipped
 * / rejected), quality score and times; polls every 2 s until terminal.
 * Rejected records are listed in an editable table for correction and
 * replay.
 */

import type {JobDto} from '@ontodecide/integration/contract';
import {Link, useParams} from '@tanstack/react-router';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  GitMerge,
  Inbox,
  RefreshCw,
  SkipForward,
  Upload,
  XCircle,
} from 'lucide-react';
import {useEffect, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {useHasRole} from '../../entities/session/store';
import {errorMessage} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {cn} from '../../shared/lib/cn';
import {fmt} from '../../shared/lib/format';
import {useOnline} from '../../shared/lib/hooks';
import {Badge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {Progress} from '../../shared/ui/progress';
import {PageLoader, Skeleton} from '../../shared/ui/skeleton';
import {toast} from '../../shared/ui/toast';
import {
  JOB_DONE,
  useJob,
  useRejected,
  useReplay,
  useSource,
} from '../../features/integration/api';
import {
  JobStatusBadge,
  qualityTone,
} from '../../features/integration/components/job_status_badge';
import {RejectedTable} from '../../features/integration/components/rejected_table';

function Counter({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: 'good' | 'crit' | 'warn' | 'cyan';
}) {
  return (
    <div
      className="glass flex flex-col gap-1 px-4 py-3"
      role="group"
      aria-label={label}
    >
      <span
        className={cn(
          'flex items-center gap-1.5 text-xs whitespace-nowrap text-muted [&_svg]:size-3.5',
          tone === 'good' && '[&_svg]:text-good',
          tone === 'crit' && '[&_svg]:text-crit',
          tone === 'warn' && '[&_svg]:text-warn',
          tone === 'cyan' && '[&_svg]:text-cyan',
        )}
      >
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'num fade-in text-[2rem] leading-none font-semibold',
          tone === 'crit' && value > 0 ? 'text-crit' : 'text-text',
        )}
      >
        {fmt.number(value)}
      </span>
    </div>
  );
}

function duration(job: JobDto, now: number): number {
  const start = Date.parse(job.startedAt);
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  return Math.max(0, Math.round((end - start) / 1000));
}

/** Progress ratio (null = indeterminate). */
function progressOf(job: JobDto): number | null {
  if (JOB_DONE.has(job.status)) return 1;
  if (job.totalGroups && job.totalGroups > 0)
    return (job.doneGroups ?? 0) / job.totalGroups;
  return null;
}

/** The job page. */
export function JobPage() {
  const {t} = useTranslation('sources');
  const {id} = useParams({strict: false}) as {id?: string};
  const canReplay = useHasRole('Operator');
  const online = useOnline();
  const job = useJob(id);
  const status = job.data?.status;
  const rejected = useRejected(id, !!job.data);
  const replay = useReplay(id ?? '');
  const source = useSource(job.data?.sourceId);
  const terminal = !!status && JOB_DONE.has(status);

  // Rejections are recorded while the job runs; refresh when it finishes.
  const refetchRejected = rejected.refetch;
  useEffect(() => {
    if (terminal) void refetchRejected();
  }, [terminal, refetchRejected]);

  if (job.isLoading) return <PageLoader />;
  if (job.error || !job.data) {
    if (isApiError(job.error, 'NOT_FOUND', 'SOURCE_NOT_FOUND')) {
      return (
        <EmptyState
          title={t('job.notFound')}
          action={
            <Button asChild variant="secondary">
              <Link to="/sources">
                <ArrowLeft aria-hidden />
                {t('job.back')}
              </Link>
            </Button>
          }
        />
      );
    }
    return (
      <ErrorView
        detail={errorMessage(job.error, t)}
        onRetry={() => void job.refetch()}
      />
    );
  }

  const j = job.data;
  const ratio = progressOf(j);
  const records = rejected.data ?? [];

  const doReplay = async (
    fixes: {id: string; payload: Record<string, unknown>}[] | undefined,
  ) => {
    try {
      const res = await replay.mutateAsync(fixes);
      toast.success(
        t('job.rejected.replayed', {
          count: res?.requeued ?? fixes?.length ?? 0,
        }),
      );
    } catch (e) {
      toast.error(t('job.rejected.replayFailed'), errorMessage(e, t));
      throw e;
    }
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <PageHeader
        breadcrumb={
          <Link to="/sources" className="hover:text-text">
            {t('list.title')}
          </Link>
        }
        title={t('job.title')}
        badges={
          <>
            <JobStatusBadge status={j.status} />
            <Badge tone="neutral">{t(`list.txn.${j.txnType}`)}</Badge>
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Mono>{j.id}</Mono>
            <span className="text-dim">·</span>
            <span>
              {t('job.source', {name: source.data?.name ?? j.sourceId})}
            </span>
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void job.refetch()}
            aria-label={t('common:actions.refresh')}
          >
            <RefreshCw
              className={cn(job.isFetching && 'animate-spin')}
              aria-hidden
            />
            {t('common:actions.refresh')}
          </Button>
        }
      />

      <Panel
        title={t('job.progress')}
        subtitle={terminal ? t('job.finished') : t('job.polling')}
        actions={
          <Badge tone={qualityTone(j.qualityScore)} className="num">
            {t('job.quality', {value: fmt.percent(j.qualityScore, 1)})}
          </Badge>
        }
      >
        <div className="flex flex-col gap-2">
          {ratio === null ? (
            <div
              role="progressbar"
              aria-label={t('job.progress')}
              aria-valuetext={t('job.receivedSoFar', {count: j.received})}
              className="relative h-1.5 w-full overflow-hidden rounded-full bg-line-2"
            >
              <div className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-[linear-gradient(90deg,var(--cyan),var(--blue))]" />
            </div>
          ) : (
            <Progress
              value={ratio}
              label={t('job.progress')}
              tone={
                j.status === 'Failed'
                  ? 'crit'
                  : j.status === 'PartiallyFailed'
                    ? 'warn'
                    : terminal
                      ? 'good'
                      : 'accent'
              }
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span className="num">
              {j.totalGroups
                ? t('job.groups', {
                    done: j.doneGroups ?? 0,
                    total: j.totalGroups,
                  })
                : t('job.receivedSoFar', {count: j.received})}
            </span>
            <span className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                {t('job.started', {time: fmt.dateTime(j.startedAt)})}
              </span>
              {j.finishedAt && (
                <span>
                  {t('job.finishedAt', {time: fmt.dateTime(j.finishedAt)})}
                </span>
              )}
              <span className="num">
                {t('job.duration', {seconds: duration(j, Date.now())})}
              </span>
            </span>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5">
        <Counter
          icon={<Inbox aria-hidden />}
          label={t('job.counters.received')}
          value={j.received}
          tone="cyan"
        />
        <Counter
          icon={<Upload aria-hidden />}
          label={t('job.counters.upserted')}
          value={j.upserted}
          tone="good"
        />
        <Counter
          icon={<GitMerge aria-hidden />}
          label={t('job.counters.merged')}
          value={j.merged}
          tone="cyan"
        />
        <Counter
          icon={<SkipForward aria-hidden />}
          label={t('job.counters.skipped')}
          value={j.skipped}
          tone="warn"
        />
        <Counter
          icon={<XCircle aria-hidden />}
          label={t('job.counters.rejected')}
          value={j.rejected}
          tone="crit"
        />
      </div>

      <Panel
        title={t('job.rejected.title')}
        subtitle={t('job.rejected.subtitle')}
      >
        {rejected.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rejected.error ? (
          <ErrorView
            detail={errorMessage(rejected.error, t)}
            onRetry={() => void rejected.refetch()}
          />
        ) : records.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden />}
            title={t('job.rejected.empty')}
          />
        ) : (
          <RejectedTable
            records={records}
            onReplay={doReplay}
            replaying={replay.isPending}
            canReplay={canReplay && online}
          />
        )}
      </Panel>
    </div>
  );
}
