/**
 * @fileoverview Empty-workspace hero: pick one of the built-in example
 * scenarios (POST /workspace/sample-data, within a global daily seed budget)
 * or import a file. QUOTA_EXCEEDED (budget used up today) is shown inline.
 * The system is not coupled to any scenario — the list comes from the
 * contract, and users may also import their own data and model a custom
 * ontology.
 */

import {BUILT_IN_SCENARIOS} from '@ontodecide/integration/contract';
import {useNavigate} from '@tanstack/react-router';
import {Clock, Database, Loader2, Upload} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
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
  const [scenarioId, setScenarioId] = useState('');
  const [progress, setProgress] = useState(0);
  const lang = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const selected = useMemo(
    () => BUILT_IN_SCENARIOS.find(s => s.id === scenarioId),
    [scenarioId],
  );

  // Simulated loading progress while the sample-data mutation is in flight.
  // The endpoint processes the import synchronously and returns 202; we cap
  // the bar at 90 % until the mutation settles, then jump to 100 %.
  useEffect(() => {
    if (!load.isPending) {
      setProgress(0);
      return;
    }
    setProgress(0);
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      // Ease toward 90 % over ~12 s; never exceed it while pending.
      const next = Math.min(0.9, 1 - Math.exp(-elapsed / 3));
      setProgress(next);
    }, 120);
    return () => clearInterval(id);
  }, [load.isPending]);
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
      <p className="max-w-xl text-sm text-muted">{t('empty.description')}</p>
      <div className="flex w-full max-w-md flex-col gap-2">
        <label className="sr-only" htmlFor="scenario-select">
          {t('empty.selectScenario')}
        </label>
        <select
          id="scenario-select"
          value={scenarioId}
          onChange={e => setScenarioId(e.target.value)}
          className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        >
          <option value="" disabled>
            {t('empty.selectScenario')}
          </option>
          {BUILT_IN_SCENARIOS.map(s => (
            <option key={s.id} value={s.id}>
              {s.name[lang]}
            </option>
          ))}
        </select>
        {selected && (
          <p className="text-xs text-muted">
            {selected.description[lang]} · {selected.objects} objects /{' '}
            {selected.links} links
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="primary"
          size="lg"
          loading={load.isPending}
          disabled={!scenarioId || load.isPending}
          onClick={() =>
            load.mutate(scenarioId, {
              onSuccess: () => {
                setProgress(1);
                toast.success(t('empty.loaded'));
              },
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
      {load.isPending && (
        <div
          role="status"
          className="flex w-full max-w-md flex-col items-center gap-2"
        >
          <div className="flex items-center gap-2 text-sm text-cyan">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('empty.loadingData')}
          </div>
          <div
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-line-2"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--cyan),var(--blue))] transition-[width] duration-150 ease-out"
              style={{width: `${Math.round(progress * 100)}%`}}
            />
          </div>
          <p className="text-xs text-muted">
            {t('empty.loadingHint', {
              pct: Math.round(progress * 100),
            })}
          </p>
        </div>
      )}
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
      ) : err ? (
        <p role="alert" className="text-xs text-crit">
          {errorMessage(err, t)}
        </p>
      ) : null}
    </section>
  );
}
