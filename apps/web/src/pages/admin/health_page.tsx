/**
 * @fileoverview System health (Admin): free-tier quota usage (bar chart
 * with the 80% warning line + accessible table), degraded dependencies,
 * dead-letter queues with replay, and graph projection rebuild.
 */

import {Share2} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useGraphRebuild} from '../../features/object-graph/api';
import {useAdminUsage} from '../../features/situation/api';
import {errorMessage} from '../../shared/api/error_message';
import {useOnline} from '../../shared/lib/hooks';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {Skeleton} from '../../shared/ui/skeleton';
import {toast} from '../../shared/ui/toast';
import {ConfirmDialog} from './confirm_dialog';
import {DeadLetterPanel} from './dead_letter_panel';
import {DegradedPanel} from './degraded_panel';
import {UsagePanel} from './usage_panel';

function GraphRebuildPanel() {
  const {t} = useTranslation('admin');
  const online = useOnline();
  const rebuild = useGraphRebuild();
  const [open, setOpen] = useState(false);
  const run = () =>
    rebuild.mutate(undefined, {
      onSuccess: r => {
        setOpen(false);
        toast.success(t('graph.queued', {count: r.queued}));
      },
      onError: e => toast.error(t('graph.failed'), errorMessage(e, t)),
    });
  return (
    <Panel
      title={t('graph.title')}
      subtitle={t('graph.subtitle')}
      icon={<Share2 aria-hidden />}
    >
      <p className="text-sm text-muted">{t('graph.description')}</p>
      <Button className="mt-3" onClick={() => setOpen(true)} disabled={!online}>
        {t('graph.rebuild')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('graph.confirmTitle')}
        description={t('graph.confirmDescription')}
        confirmLabel={t('graph.rebuild')}
        loading={rebuild.isPending}
        disabled={!online}
        onConfirm={run}
      />
    </Panel>
  );
}

/** System health page. */
export function HealthPage() {
  const {t} = useTranslation('admin');
  const usage = useAdminUsage();
  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        title={t('health.title')}
        description={t('health.description')}
      />
      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 xl:col-span-7">
          {usage.isError ? (
            <div className="glass">
              <ErrorView
                detail={errorMessage(usage.error, t)}
                onRetry={() => void usage.refetch()}
              />
            </div>
          ) : usage.isLoading ? (
            <Skeleton className="h-[480px] rounded-[14px]" />
          ) : (
            <UsagePanel
              usage={usage.data}
              loading={usage.isFetching}
              onRefresh={() => void usage.refetch()}
            />
          )}
        </div>
        <div className="col-span-12 flex flex-col gap-3.5 xl:col-span-5">
          <DegradedPanel degraded={usage.data?.degraded} />
          <GraphRebuildPanel />
        </div>
        <div className="col-span-12">
          <DeadLetterPanel />
        </div>
      </div>
    </div>
  );
}
