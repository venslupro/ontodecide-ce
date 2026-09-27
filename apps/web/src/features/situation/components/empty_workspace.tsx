/**
 * @fileoverview Empty-workspace hero: 「加载示例场景」 (POST
 * /workspace/sample-data: 80 objects / 160 links, once per workspace, within
 * a global daily seed budget) and 「导入文件」. QUOTA_EXCEEDED (budget used
 * up today) and CONFLICT (already loaded) are shown inline.
 */

import {SAMPLE_SCENARIO} from '@ontodecide/integration/contract';
import {useNavigate} from '@tanstack/react-router';
import {Clock, Database, Upload} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../../../shared/api/error_message';
import {isApiError} from '../../../shared/api/errors';
import {Button} from '../../../shared/ui/button';
import {toast} from '../../../shared/ui/toast';
import {useQuotas} from '../../../entities/quota';
import {useLoadSample} from '../api';
import {formatResetTime, quotaResetAt} from './quota_notice';

/** Empty-workspace call to action. */
export function EmptyWorkspace() {
  const {t, i18n} = useTranslation('cockpit');
  const navigate = useNavigate();
  const load = useLoadSample();
  const {quotas, timeZone} = useQuotas();
  const err = load.error;
  return (
    <section
      className="glass flex flex-col items-center gap-4 px-6 py-12 text-center"
      aria-labelledby="empty-ws-title"
    >
      <div className="flex size-14 items-center justify-center rounded-full border border-cyan/40 bg-cyan/10 text-cyan">
        <Database className="size-6" aria-hidden />
      </div>
      <h2 id="empty-ws-title" className="text-lg font-semibold text-text">
        {t('empty.title')}
      </h2>
      <p className="max-w-xl text-sm text-muted">
        {t('empty.description', {
          objects: SAMPLE_SCENARIO.objects,
          links: SAMPLE_SCENARIO.links,
        })}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="primary"
          size="lg"
          loading={load.isPending}
          onClick={() =>
            load.mutate(undefined, {
              onSuccess: () => toast.success(t('empty.loaded')),
            })
          }
        >
          <Database aria-hidden />
          {t('empty.loadSample')}
        </Button>
        <Button size="lg" onClick={() => void navigate({to: '/imports/new'})}>
          <Upload aria-hidden />
          {t('empty.importFile')}
        </Button>
      </div>
      {isApiError(err, 'QUOTA_EXCEEDED') ? (
        <p
          role="status"
          className="inline-flex items-center gap-1.5 text-xs text-warn"
        >
          <Clock className="size-3.5" aria-hidden />
          {t('empty.budgetUsed', {
            at: formatResetTime(
              quotaResetAt(err, quotas?.resetsAt),
              i18n.language,
              timeZone,
            ),
          })}
        </p>
      ) : isApiError(err, 'CONFLICT') ? (
        <p role="status" className="text-xs text-muted">
          {t('empty.alreadyLoaded')}
        </p>
      ) : err ? (
        <p role="alert" className="text-xs text-crit">
          {errorMessage(err, t)}
        </p>
      ) : null}
    </section>
  );
}
