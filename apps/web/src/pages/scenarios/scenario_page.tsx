/**
 * @fileoverview Scenario simulation page (前端详细设计 情景推演, 效果图 c6):
 * `/scenarios` (new; `?rid=<focus>&alert=<id>` prefills a perturbation) and
 * `/scenarios/$id` (stored scenario, editable and re-runnable). Left:
 * perturbations (≤ 10) and candidate actions from the ontology; middle:
 * impact graph; right: 基线 / 情景 / 情景 + 动作 comparison computed by the
 * deterministic simulator. 「生成 AI 建议」 shows today's remaining AI
 * rankings; when used up the recommendation is still generated, rule ranked.
 * 「保存情景」 names the scenario: saving = running it with that name
 * (POST /scenarios stores every run), confirmed with a toast and badge.
 * 「延误时长」 perturbations are converted with the objects' current values.
 */

import {resolveText} from '@ontodecide/shared-kernel';
import {useQueries} from '@tanstack/react-query';
import {useLocation, useNavigate, useParams} from '@tanstack/react-router';
import {BarChart3, Play, Save, Sparkles} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {isExhausted, useQuotas} from '../../entities/quota';
import {useUiModel} from '../../entities/schema/api';
import {
  numericProperties,
  shortRid,
  typeOfRid,
} from '../../entities/schema/model';
import {
  useGenerateRecommendation,
  useRunScenario,
  useScenario,
} from '../../features/decision/api';
import {CandidateList} from '../../features/decision/components/candidate_list';
import {ImpactPanel} from '../../features/decision/components/impact_panel';
import {
  DeterministicNote,
  KpiChart,
  KpiTable,
} from '../../features/decision/components/kpi_comparison';
import {PerturbationEditor} from '../../features/decision/components/perturbation_editor';
import {
  bestCandidateId,
  candidateKey,
  candidateOptions,
  type CandidateSelection,
  type CurrentValue,
  draftChange,
  isCompleteDraft,
  newPerturbation,
  type PerturbationDraft,
  routeId,
  toScenarioInput,
} from '../../features/decision/model';
import {
  fetchObject,
  objectKeys,
  useLinks,
} from '../../features/object-graph/api';
import {
  searchString,
  useLooseSearch,
} from '../../features/object-graph/search_params';
import {
  QuotaNotice,
  QuotaRemaining,
} from '../../features/situation/components/quota_notice';
import {errorMessage, errorTraceId} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {StatusBadge} from '../../shared/ui/badge';
import {Button} from '../../shared/ui/button';
import {Card, Panel} from '../../shared/ui/card';
import {Dialog, DialogContent} from '../../shared/ui/dialog';
import {Field, Input} from '../../shared/ui/input';
import {toast} from '../../shared/ui/toast';
import {EmptyState, ErrorView} from '../../shared/ui/empty_state';
import {PageHeader} from '../../shared/ui/page_header';
import {NativeSelect} from '../../shared/ui/select';
import {PageLoader} from '../../shared/ui/skeleton';

const RISK_LEVEL = {LOW: 'good', MEDIUM: 'warn', HIGH: 'crit'} as const;

/** Scenario simulation page. */
export function ScenarioPage() {
  const {t, i18n} = useTranslation('scenarios');
  const navigate = useNavigate();
  const params = useParams({strict: false}) as {id?: string};
  const {pathname} = useLocation();
  const id = routeId(params, pathname, 'scenarios');
  const search = useLooseSearch();
  const focusParam = searchString(search, 'rid');
  const alertId = searchString(search, 'alert');

  const {model} = useUiModel();
  const scenario = useScenario(id);
  const dto = scenario.data;
  const run = useRunScenario();
  const generate = useGenerateRecommendation();
  const {quotas} = useQuotas();

  const [drafts, setDrafts] = useState<PerturbationDraft[]>([]);
  const [selection, setSelection] = useState<CandidateSelection>({});
  const [initFor, setInitFor] = useState<string | null>(null);
  const [pickedCandidate, setPickedCandidate] = useState<string>();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);

  // Load the stored scenario into the editor (once per id).
  useEffect(() => {
    if (!dto || initFor === dto.id) return;
    setInitFor(dto.id);
    setDrafts(
      dto.perturbations.map(p =>
        newPerturbation({
          rid: p.rid,
          property: p.property,
          changePct: p.change * 100,
        }),
      ),
    );
    setSelection(
      Object.fromEntries(dto.candidates.map(c => [candidateKey(c), c.params])),
    );
    setPickedCandidate(undefined);
  }, [dto, initFor]);

  // New scenario from `?rid=`: prefill one perturbation on that object.
  useEffect(() => {
    if (id || !focusParam || initFor === `new:${focusParam}`) return;
    if (!model.types.length) return;
    setInitFor(`new:${focusParam}`);
    const prop = numericProperties(
      model.byName[typeOfRid(focusParam) ?? ''],
    )[0];
    setDrafts([
      newPerturbation({rid: focusParam, property: prop?.apiName ?? ''}),
    ]);
    setSelection({});
  }, [id, focusParam, initFor, model]);

  const rids = useMemo(
    () => [...new Set(drafts.filter(isCompleteDraft).map(d => d.rid))],
    [drafts],
  );
  const firstRid = rids[0] ?? dto?.perturbations[0]?.rid;
  const objects = useQueries({
    queries: rids.map(rid => ({
      queryKey: objectKeys.one(rid),
      queryFn: () => fetchObject(rid),
      staleTime: 60_000,
    })),
  });
  const links = useLinks(firstRid, 2);

  const titles = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of links.data?.nodes ?? []) out[n.rid] = n.title;
    for (const a of dto?.result.affected ?? []) out[a.rid] = a.title;
    for (const c of dto?.candidates ?? []) out[c.target] = c.targetTitle;
    for (const o of objects) if (o.data) out[o.data.rid] = o.data.title;
    return out;
  }, [links.data, dto, objects]);

  const options = useMemo(() => {
    const list: {rid: string; title: string; type?: string}[] = [];
    const add = (rid: string, type?: string) =>
      list.push({rid, type, title: titles[rid] ?? shortRid(rid)});
    for (const r of rids) add(r);
    for (const c of dto?.candidates ?? []) add(c.target);
    for (const a of dto?.result.affected ?? []) add(a.rid, a.type);
    for (const n of links.data?.nodes ?? []) add(n.rid, n.type);
    return candidateOptions(model, list);
  }, [rids, dto, links.data, model, titles]);

  const result = dto?.result;
  const candidateIds = useMemo(
    () => (dto?.candidates ?? []).filter(c => result?.withActions?.[c.id]),
    [dto, result],
  );
  const shownCandidate =
    pickedCandidate ??
    (result ? bestCandidateId(result, dto?.candidates ?? []) : undefined);
  const withActions = shownCandidate
    ? result?.withActions?.[shownCandidate]
    : undefined;

  const current = useMemo<CurrentValue>(() => {
    const byRid = new Map<string, Record<string, unknown>>(
      objects.filter(o => o.data).map(o => [o.data!.rid, o.data!.props]),
    );
    return (rid, prop) => byRid.get(rid)?.[prop];
  }, [objects]);
  const unitOf = (rid: string, prop: string) =>
    model.byName[typeOfRid(rid) ?? '']?.properties.find(p => p.apiName === prop)
      ?.unit;
  const runnable = drafts.filter(
    d =>
      isCompleteDraft(d) &&
      draftChange(d, current, unitOf(d.rid, d.property)) !== null,
  );
  const canRun = runnable.length > 0;
  const input = (name?: string) =>
    toScenarioInput(drafts, selection, options, name, current, unitOf);
  const onRun = () => {
    run.mutate(input(), {
      onSuccess: s => void navigate({to: '/scenarios/$id', params: {id: s.id}}),
    });
  };
  const onSave = () => {
    const name = saveName.trim();
    if (!name) return;
    run.mutate(input(name), {
      onSuccess: s => {
        setSaveOpen(false);
        setSavedId(s.id);
        toast.success(t('save.saved', {name: s.name}));
        void navigate({to: '/scenarios/$id', params: {id: s.id}});
      },
    });
  };

  const aiUsedUp = isExhausted(quotas?.aiRecsToday);
  const onGenerate = () => {
    if (!firstRid) return;
    generate.mutate(
      {
        focus: firstRid as never,
        ...(id ? {scenarioId: id} : {}),
        ...(alertId ? {alertId} : {}),
      },
      {
        onSuccess: rec =>
          void navigate({to: '/recommendations/$id', params: {id: rec.id}}),
      },
    );
  };

  if (id && scenario.isLoading) return <PageLoader />;
  if (id && scenario.error)
    return (
      <ErrorView
        traceId={errorTraceId(scenario.error)}
        title={t('loadError')}
        detail={errorMessage(scenario.error, t)}
        onRetry={
          isApiError(scenario.error, 'NOT_FOUND')
            ? undefined
            : () => void scenario.refetch()
        }
      />
    );

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader
        breadcrumb={id ? `${t('title')} / ${id.toUpperCase()}` : t('title')}
        title={dto?.name ?? t('newTitle')}
        description={dto ? undefined : t('description')}
        badges={
          result || (savedId && savedId === id) ? (
            <>
              {result && (
                <StatusBadge level={RISK_LEVEL[result.riskLevel]}>
                  {t(`riskLevel.${result.riskLevel}`)}
                </StatusBadge>
              )}
              {savedId && savedId === id && (
                <StatusBadge level="good">{t('save.savedBadge')}</StatusBadge>
              )}
            </>
          ) : undefined
        }
        actions={
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <QuotaRemaining quota="aiRecsToday" />
              <Button
                variant="outline"
                disabled={!canRun || run.isPending}
                onClick={() => {
                  setSaveName(dto?.name ?? '');
                  setSaveOpen(true);
                }}
              >
                <Save aria-hidden />
                {t('save.button')}
              </Button>
              <Button
                variant="primary"
                loading={generate.isPending}
                disabled={!firstRid || generate.isPending}
                title={firstRid ? undefined : t('ai.needFocus')}
                onClick={onGenerate}
              >
                <Sparkles aria-hidden />
                {t('ai.generate')}
              </Button>
            </div>
            {aiUsedUp && !generate.error && (
              <p className="text-xs text-muted">{t('ai.rulesHint')}</p>
            )}
            <QuotaNotice error={generate.error} quota="aiRecsToday" />
            {generate.error &&
              !isApiError(generate.error, 'QUOTA_EXCEEDED') && (
                <p role="alert" className="text-xs text-crit">
                  {errorMessage(generate.error, t)}
                </p>
              )}
          </div>
        }
      />
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)_minmax(0,1.4fr)]">
        <Card className="flex min-w-0 flex-col gap-5 p-4">
          <PerturbationEditor
            drafts={drafts}
            onChange={setDrafts}
            model={model}
            titles={titles}
            current={current}
          />
          <CandidateList
            options={options}
            selection={selection}
            onChange={setSelection}
          />
          <div className="flex flex-col gap-1.5">
            <Button
              variant="primary"
              size="lg"
              loading={run.isPending}
              disabled={!canRun || run.isPending}
              onClick={onRun}
            >
              <Play aria-hidden />
              {t('run')}
            </Button>
            {!canRun && <p className="text-xs text-dim">{t('runHint')}</p>}
            {canRun &&
              runnable.length < drafts.filter(isCompleteDraft).length && (
                <p className="text-xs text-warn">
                  {t('perturb.delayNoCurrent')}
                </p>
              )}
            {run.error && (
              <p role="alert" className="text-xs text-crit">
                {errorMessage(run.error, t)}
              </p>
            )}
          </div>
        </Card>

        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogContent
            title={t('save.title')}
            description={t('save.hint')}
            size="sm"
            footer={
              <>
                <Button variant="ghost" onClick={() => setSaveOpen(false)}>
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  variant="primary"
                  loading={run.isPending}
                  disabled={!saveName.trim() || run.isPending}
                  onClick={onSave}
                >
                  {t('save.submit')}
                </Button>
              </>
            }
          >
            <form
              onSubmit={e => {
                e.preventDefault();
                onSave();
              }}
            >
              <Field label={t('save.nameLabel')} htmlFor="scenario-name">
                <Input
                  id="scenario-name"
                  maxLength={120}
                  autoFocus
                  placeholder={t('save.namePlaceholder')}
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                />
              </Field>
            </form>
            {run.error && saveOpen && (
              <p role="alert" className="mt-2 text-xs text-crit">
                {errorMessage(run.error, t)}
              </p>
            )}
          </DialogContent>
        </Dialog>

        <ImpactPanel result={result} focusRid={dto?.perturbations[0]?.rid} />

        <Panel title={t('compare.title')} icon={<BarChart3 aria-hidden />}>
          {result ? (
            <div className="flex flex-col gap-3">
              {candidateIds.length > 1 && (
                <NativeSelect
                  size="sm"
                  aria-label={t('compare.candidate')}
                  value={shownCandidate ?? ''}
                  options={candidateIds.map(c => ({
                    value: c.id,
                    label: `${resolveText(c.displayName, i18n.language, c.actionType)} → ${c.targetTitle}`,
                  }))}
                  onChange={e => setPickedCandidate(e.target.value)}
                />
              )}
              <KpiChart result={result} withActions={withActions} />
              <KpiTable result={result} withActions={withActions} />
              <DeterministicNote />
            </div>
          ) : (
            <EmptyState
              icon={<BarChart3 aria-hidden />}
              title={t('compare.empty')}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
