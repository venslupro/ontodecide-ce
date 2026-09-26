/**
 * @fileoverview Scenario simulation (情景推演): perturbations + candidate
 * actions → deterministic simulator run → three-way KPI comparison
 * (baseline / scenario / scenario + action), impact heat graph and one-click
 * AI recommendation generation. All numbers come from the simulator.
 */

import type {
  ScenarioInput,
  ScenarioResult,
} from '@ontodecide/decision/contract';
import {scenarioInputSchema} from '@ontodecide/decision/contract';
import {parseRid, resolveText} from '@ontodecide/shared-kernel';
import {Link, useNavigate, useParams, useSearch} from '@tanstack/react-router';
import {Bell, Calculator, FlaskConical, Info, Play} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useUiModel} from '../../entities/schema/api';
import {
  useCandidates,
  useCreateScenario,
  useRunScenario,
  useScenario,
} from '../../features/decision/api';
import {AiGenerateButton} from '../../features/decision/components/ai_generate_button';
import {
  CandidateList,
  CANDIDATES_MAX,
} from '../../features/decision/components/candidate_list';
import {ImpactPanel} from '../../features/decision/components/impact_panel';
import {
  KpiChart,
  KpiTable,
} from '../../features/decision/components/kpi_comparison';
import {
  numericProps,
  PerturbationEditor,
  type PerturbationErrors,
} from '../../features/decision/components/perturbation_editor';
import {
  candidateByKey,
  completePerturbations,
  newPerturbationDraft,
  parseActionKey,
  type PerturbationDraft,
  riskLevelStatus,
  shortRid,
} from '../../features/decision/model';
import {errorMessage} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {fmt} from '../../shared/lib/format';
import {useDebouncedValue, useOnline} from '../../shared/lib/hooks';
import {DegradedBadge, StatusBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Panel} from '../../shared/ui/card';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {Field, Input} from '../../shared/ui/input';
import {PageHeader} from '../../shared/ui/page_header';
import {NativeSelect} from '../../shared/ui/select';
import {PageLoader, Spinner} from '../../shared/ui/skeleton';

/** Scenario page. */
export function ScenarioPage() {
  const {t, i18n} = useTranslation('scenarios');
  const params = useParams({strict: false}) as {id?: string};
  const search = useSearch({strict: false}) as {rid?: string; alertId?: string};
  const navigate = useNavigate();
  const online = useOnline();
  const {model} = useUiModel();
  const id = params.id ?? 'new';
  const isNew = id === 'new';
  const scenarioQ = useScenario(id);
  const create = useCreateScenario();
  const run = useRunScenario();

  const [rows, setRows] = useState<PerturbationDraft[]>(() => [
    newPerturbationDraft({rid: search.rid ?? ''}),
  ]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<PerturbationErrors>({});
  const [formError, setFormError] = useState<string>();
  const [runResult, setRunResult] = useState<ScenarioResult | null>(null);
  const [runError, setRunError] = useState<unknown>(null);
  const [actionSel, setActionSel] = useState('');
  const initFor = useRef<string | null>(isNew ? 'new' : null);

  // Load a stored scenario into the editor (not after our own create → navigate).
  useEffect(() => {
    const s = scenarioQ.data;
    if (!s || initFor.current === s.id) return;
    initFor.current = s.id;
    setRows(
      s.perturbations.length
        ? s.perturbations.map(p => newPerturbationDraft(p))
        : [newPerturbationDraft()],
    );
    setName(s.name);
    setSelected(new Set());
    setRunResult(null);
    setRunError(null);
  }, [scenarioQ.data]);

  // Prefill the first numeric property once the schema is known (?rid=).
  useEffect(() => {
    if (!model.types.length) return;
    setRows(rs =>
      rs.some(r => r.rid && !r.property)
        ? rs.map(r =>
            r.rid && !r.property
              ? {...r, property: numericProps(model, r.rid)[0]?.apiName ?? ''}
              : r,
          )
        : rs,
    );
  }, [model]);

  const perturbations = useMemo(() => completePerturbations(rows), [rows]);
  const debounced = useDebouncedValue(perturbations, 300);
  const candidatesQ = useCandidates(debounced);
  const candidates = candidatesQ.data;
  const byKey = useMemo(() => candidateByKey(candidates), [candidates]);

  // Drop selections that are no longer offered / eligible.
  useEffect(() => {
    if (!candidates) return;
    setSelected(sel => {
      const next = new Set([...sel].filter(k => byKey.get(k)?.eligible));
      return next.size === sel.size ? sel : next;
    });
  }, [candidates, byKey]);

  const result = runResult ?? scenarioQ.data?.result ?? null;
  const actionKeys = Object.keys(result?.withActions ?? {});
  const activeKey = actionKeys.includes(actionSel)
    ? actionSel
    : (actionKeys[0] ?? '');
  const withAction = activeKey ? result?.withActions?.[activeKey] : undefined;
  const roots = useMemo(
    () => [...new Set(perturbations.map(p => p.rid as string))],
    [perturbations],
  );
  const running = create.isPending || run.isPending;

  const actionLabel = (key: string) => {
    const c = byKey.get(key);
    if (c)
      return `${resolveText(c.displayName, i18n.language, c.actionType)} · ${c.targetTitle}`;
    const {actionType, target} = parseActionKey(key);
    const def = model.actions.find(a => a.apiName === actionType);
    const title =
      result?.affected.find(a => a.rid === target)?.title ?? shortRid(target);
    return `${def?.displayName ?? actionType} · ${title}`;
  };

  const validate = (): ScenarioInput | null => {
    const input: ScenarioInput = {
      name: name.trim() || undefined,
      perturbations: rows.map(r => ({
        rid: r.rid as ScenarioInput['perturbations'][number]['rid'],
        property: r.property,
        change: r.change,
      })),
      candidateActions: [...selected]
        .map(k => byKey.get(k))
        .filter(c => c !== undefined)
        .slice(0, CANDIDATES_MAX)
        .map(c => ({
          actionType: c.actionType,
          target: c.target,
          params: c.params,
        })),
    };
    const parsed = scenarioInputSchema.safeParse(input);
    if (parsed.success) {
      setErrors({});
      setFormError(undefined);
      return input;
    }
    const errs: PerturbationErrors = {};
    let other: string | undefined;
    for (const issue of parsed.error.issues) {
      const [root, idx, field] = issue.path;
      if (root === 'perturbations' && typeof idx === 'number' && rows[idx]) {
        const key = rows[idx].key;
        const e = (errs[key] ??= {});
        if (field === 'rid') e.rid = t('validation.rid');
        else if (field === 'property') e.property = t('validation.property');
        else if (field === 'change') e.change = t('validation.change');
      } else if (root === 'name') {
        other = t('validation.name');
      } else if (root === 'perturbations') {
        other = t('validation.perturbations');
      } else {
        other = t('validation.generic');
      }
    }
    setErrors(errs);
    setFormError(other);
    return null;
  };

  const onRun = async () => {
    const input = validate();
    if (!input) return;
    setRunError(null);
    try {
      let sid = id;
      if (isNew) {
        const s = await create.mutateAsync({
          ...input,
          name:
            input.name ??
            t('page.defaultName', {time: fmt.dateTime(Date.now())}),
        });
        sid = s.id;
        initFor.current = s.id;
        setName(s.name);
        void navigate({
          to: '/scenarios/$id',
          params: {id: s.id},
          search: {alertId: search.alertId},
          replace: true,
        });
      }
      const r = await run.mutateAsync({id: sid, input});
      setRunResult(r);
    } catch (e) {
      setRunError(e);
    }
  };

  if (!isNew && scenarioQ.isLoading) return <PageLoader />;
  if (!isNew && scenarioQ.error) {
    if (isApiError(scenarioQ.error, 'NOT_FOUND')) {
      return (
        <div className="glass">
          <EmptyState
            icon={<FlaskConical aria-hidden />}
            title={t('page.notFound')}
            action={
              <Button asChild size="sm">
                <Link to="/scenarios">{t('page.backToList')}</Link>
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <ErrorView
        className="glass"
        detail={errorMessage(scenarioQ.error, t)}
        onRetry={() => void scenarioQ.refetch()}
      />
    );
  }

  const firstRid = perturbations[0]?.rid;
  const unmet = isApiError(runError, 'PRECONDITION_FAILED')
    ? (runError.extras.unmet as string[] | undefined)
    : undefined;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        breadcrumb={
          <Link to="/scenarios" className="hover:text-cyan">
            {t('list.title')}
          </Link>
        }
        title={isNew ? t('page.newTitle') : scenarioQ.data?.name || id}
        description={t('page.description')}
        badges={
          search.alertId ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-muted">
              <Bell className="size-3" aria-hidden />
              {t('page.fromAlert', {id: search.alertId})}
            </span>
          ) : undefined
        }
        actions={
          <Button
            variant="primary"
            onClick={() => void onRun()}
            loading={running}
            disabled={!online}
          >
            <Play aria-hidden />
            {running ? t('page.running') : t('page.run')}
          </Button>
        }
      />

      <div className="grid grid-cols-12 gap-3.5">
        <div className="col-span-12 flex min-w-0 flex-col gap-3.5 xl:col-span-5">
          <Panel
            title={t('perturbation.title')}
            subtitle={t('perturbation.subtitle')}
          >
            <div className="flex flex-col gap-3">
              <Field
                label={t('page.name')}
                htmlFor="scenario-name"
                error={formError}
              >
                <Input
                  id="scenario-name"
                  value={name}
                  maxLength={100}
                  placeholder={t('page.namePlaceholder')}
                  onChange={e => setName(e.target.value)}
                  disabled={running}
                />
              </Field>
              <PerturbationEditor
                rows={rows}
                onChange={setRows}
                errors={errors}
                disabled={running}
              />
            </div>
          </Panel>

          <Panel
            title={t('candidates.title')}
            subtitle={t('candidates.subtitle')}
            actions={
              candidatesQ.isFetching && !candidatesQ.isLoading ? (
                <Spinner />
              ) : undefined
            }
          >
            {candidatesQ.error ? (
              <p role="alert" className="text-xs text-crit">
                {errorMessage(candidatesQ.error, t)}
              </p>
            ) : (
              <CandidateList
                candidates={debounced.length ? candidates : []}
                loading={candidatesQ.isLoading && debounced.length > 0}
                selected={selected}
                disabled={running}
                onToggle={(k, on) =>
                  setSelected(sel => {
                    const next = new Set(sel);
                    if (on && next.size < CANDIDATES_MAX) next.add(k);
                    else next.delete(k);
                    return next;
                  })
                }
              />
            )}
          </Panel>
        </div>

        <div className="col-span-12 flex min-w-0 flex-col gap-3.5 xl:col-span-7">
          <Panel
            title={t('result.title')}
            icon={<Calculator aria-hidden />}
            aria-busy={running || undefined}
            actions={
              result ? (
                <>
                  <StatusBadge level={riskLevelStatus(result.riskLevel)}>
                    {t('result.risk', {
                      level: t(`common:severity.${result.riskLevel}`),
                    })}
                  </StatusBadge>
                  {result.degraded && (
                    <DegradedBadge reason={t('result.degraded')} />
                  )}
                </>
              ) : undefined
            }
          >
            <p className="mb-3 flex items-center gap-1.5 text-xs text-muted">
              <Info className="size-3.5 text-cyan" aria-hidden />
              {t('result.simulatorNote')}
            </p>
            {runError ? (
              <div
                role="alert"
                className="mb-3 rounded-[10px] border border-crit/40 bg-crit/10 px-3 py-2 text-sm"
              >
                <p className="font-medium text-crit">
                  {errorMessage(runError, t)}
                </p>
                {isApiError(runError) &&
                  runError.detail &&
                  errorMessage(runError, t) !== runError.detail && (
                    <p className="mt-0.5 text-xs text-muted">
                      {runError.detail}
                    </p>
                  )}
                {isApiError(runError, 'GRAPH_TOO_LARGE') && (
                  <p className="mt-0.5 text-xs text-muted">
                    {t('result.tooLargeHint')}
                  </p>
                )}
                {unmet && unmet.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs text-text">
                    {unmet.map(u => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            {running ? (
              <div
                className="flex min-h-48 flex-col items-center justify-center gap-2"
                role="status"
              >
                <Spinner label={t('page.running')} />
                <p className="text-sm text-muted">{t('page.running')}</p>
              </div>
            ) : result ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className="num">
                      {t('result.nodeCount', {count: result.nodeCount})}
                    </span>
                    <span>
                      {t('result.computedAt', {
                        time: fmt.dateTime(result.computedAt),
                      })}
                    </span>
                  </span>
                  {actionKeys.length > 1 && (
                    <label className="flex items-center gap-2">
                      <span className="whitespace-nowrap">
                        {t('result.actionSet')}
                      </span>
                      <NativeSelect
                        size="sm"
                        value={activeKey}
                        onChange={e => setActionSel(e.target.value)}
                        options={actionKeys.map(k => ({
                          value: k,
                          label: actionLabel(k),
                        }))}
                      />
                    </label>
                  )}
                  {actionKeys.length === 1 && (
                    <span className="text-xs">
                      {t('result.actionSetSingle', {
                        action: actionLabel(activeKey),
                      })}
                    </span>
                  )}
                </div>
                <KpiChart result={result} withAction={withAction} />
                <KpiTable result={result} withAction={withAction} />
              </div>
            ) : (
              <EmptyState
                icon={<Calculator aria-hidden />}
                title={t('result.empty')}
                description={t('result.emptyHint')}
              />
            )}
          </Panel>

          <Panel title={t('ai.title')} subtitle={t('ai.subtitle')}>
            <AiGenerateButton
              scenarioId={isNew ? undefined : id}
              focus={firstRid}
              alertId={search.alertId}
              objectType={firstRid ? parseRid(firstRid)?.objectType : undefined}
              blockedReason={
                isNew
                  ? t('ai.saveFirst')
                  : !firstRid
                    ? t('ai.needPerturbation')
                    : undefined
              }
            />
          </Panel>
        </div>

        {result && !running && (
          <div className="col-span-12">
            <Panel title={t('impact.title')} subtitle={t('impact.subtitle')}>
              <ImpactPanel result={result} roots={roots} />
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
