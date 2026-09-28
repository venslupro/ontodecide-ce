/**
 * @fileoverview Import job result (/imports/$id): status, totals
 * (upserted / skipped / rejected), the rejects table (row / column / code /
 * detail — never cell values) and a link to the objects of the target type.
 */

import {Link, useParams} from '@tanstack/react-router';
import {ArrowLeft, Boxes} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useImportJob} from '../../features/integration/api';
import {JobStatusBadge} from '../../features/integration/components/job_status_badge';
import {RejectedTable} from '../../features/integration/components/rejected_table';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {fmt} from '../../shared/lib/format';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Mono, PageHeader} from '../../shared/ui/page_header';
import {PageLoader} from '../../shared/ui/skeleton';

const TOTALS = [
  'totalRows',
  'received',
  'upserted',
  'skipped',
  'rejected',
] as const;

const TONE: Record<(typeof TOTALS)[number], string> = {
  totalRows: 'text-text',
  received: 'text-text',
  upserted: 'text-good',
  skipped: 'text-muted',
  rejected: 'text-crit',
};

/** Import job page. `jobId` overrides the route parameter (tests). */
export function ImportJobPage({jobId}: {jobId?: string} = {}) {
  const {t} = useTranslation('imports');
  const params = useParams({strict: false}) as {id?: string};
  const id = jobId ?? params.id;
  const q = useImportJob(id);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) {
    return isApiError(q.error, 'NOT_FOUND') || !q.error ? (
      <EmptyState title={t('job.notFound')} />
    ) : (
      <ErrorView
        traceId={errorTraceId(q.error)}
        detail={errorMessage(q.error, t)}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const job = q.data;
  const rejects = job.rejects ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={
          <Link to="/imports" className="hover:text-text">
            {t('job.breadcrumb', {id: job.id})}
          </Link>
        }
        title={job.fileName ?? t('list.sample')}
        badges={<JobStatusBadge status={job.status} />}
        description={
          <>
            {t('job.target')}: <Mono>{job.targetType}</Mono> ·{' '}
            {t('job.created', {at: fmt.dateTime(job.createdAt)})}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/imports">
                <ArrowLeft aria-hidden />
                {t('job.back')}
              </Link>
            </Button>
            <Button asChild variant="primary">
              <Link to="/objects" search={{type: job.targetType}}>
                <Boxes aria-hidden />
                {t('job.viewObjects', {type: job.targetType})}
              </Link>
            </Button>
          </>
        }
      />
      <dl
        aria-label={t('job.totalsLabel')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-5"
      >
        {TOTALS.map(k => (
          <div key={k} className="glass flex flex-col gap-1 p-4">
            <dt className="text-xs text-muted">{t(`job.totals.${k}`)}</dt>
            <dd className={`num text-2xl font-semibold ${TONE[k]}`}>
              {fmt.number(job[k])}
            </dd>
          </div>
        ))}
      </dl>
      <Panel title={t('job.rejects')} subtitle={t('job.rejectsHint')}>
        {rejects.length === 0 ? (
          <p className="text-sm text-muted">{t('job.noRejects')}</p>
        ) : (
          <RejectedTable rejects={rejects} />
        )}
      </Panel>
      {job.mapping && (
        <Panel title={t('job.mapping')}>
          <ul className="flex flex-wrap gap-2 text-xs">
            {job.mapping.fields.map(f => (
              <li
                key={`${f.from}:${f.to}`}
                className="rounded-md border border-line-2 px-2 py-1 font-mono"
              >
                {t('job.mappingLine', {from: f.from, to: f.to})}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
