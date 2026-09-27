/**
 * @fileoverview Import job list (/imports): file name, target type, status,
 * counts and creation time; CTA 「新建导入」 → /imports/new.
 */

import type {JobDto} from '@ontodecide/integration/contract';
import {Link} from '@tanstack/react-router';
import {FileUp, Plus} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useImports} from '../../features/integration/api';
import {JobStatusBadge} from '../../features/integration/components/job_status_badge';
import {errorMessage} from '../../shared/api/error_message';
import {fmt} from '../../shared/lib/format';
import {Button} from '../../shared/ui/button';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {Table, TBody, Td, Th, THead, Tr} from '../../shared/ui/table';

function JobRow({job}: {job: JobDto}) {
  const {t} = useTranslation('imports');
  const name = job.fileName ?? t('list.sample');
  return (
    <Tr>
      <Td className="font-medium">
        <Link
          to="/imports/$id"
          params={{id: job.id}}
          className="text-text hover:text-cyan hover:underline"
        >
          {name}
        </Link>
        <div className="font-mono text-[11px] text-dim">{job.id}</div>
      </Td>
      <Td className="font-mono text-xs">{job.targetType}</Td>
      <Td>
        <JobStatusBadge status={job.status} />
      </Td>
      <Td className="num text-xs">{fmt.number(job.totalRows)}</Td>
      <Td className="num text-xs whitespace-nowrap">
        <span className="text-good">{fmt.number(job.upserted)}</span>
        {' / '}
        <span className="text-muted">{fmt.number(job.skipped)}</span>
        {' / '}
        <span className={job.rejected > 0 ? 'text-crit' : 'text-muted'}>
          {fmt.number(job.rejected)}
        </span>
      </Td>
      <Td className="text-xs whitespace-nowrap text-muted">
        <time dateTime={job.createdAt} title={fmt.dateTime(job.createdAt)}>
          {fmt.ago(job.createdAt)}
        </time>
      </Td>
      <Td className="text-right">
        <Button asChild size="sm" variant="ghost">
          <Link
            to="/imports/$id"
            params={{id: job.id}}
            aria-label={t('list.openAria', {name})}
          >
            {t('list.open')}
          </Link>
        </Button>
      </Td>
    </Tr>
  );
}

/** Import list page. */
export function ImportsPage() {
  const {t} = useTranslation('imports');
  const q = useImports();
  const items = [...(q.data?.items ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const cta = (
    <Button asChild variant="primary">
      <Link to="/imports/new">
        <Plus aria-hidden />
        {t('list.new')}
      </Link>
    </Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        actions={cta}
      />
      <section
        className="glass overflow-hidden"
        aria-busy={q.isLoading || undefined}
      >
        {q.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.error ? (
          <ErrorView
            detail={errorMessage(q.error, t)}
            onRetry={() => void q.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<FileUp aria-hidden />}
            title={t('list.empty')}
            description={t('list.emptyHint')}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label={t('list.title')}>
              <THead>
                <Tr>
                  <Th>{t('list.col.file')}</Th>
                  <Th>{t('list.col.target')}</Th>
                  <Th>{t('list.col.status')}</Th>
                  <Th>{t('list.col.rows')}</Th>
                  <Th>{t('list.col.counts')}</Th>
                  <Th>{t('list.col.created')}</Th>
                  <Th />
                </Tr>
              </THead>
              <TBody>
                {items.map(j => (
                  <JobRow key={j.id} job={j} />
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
