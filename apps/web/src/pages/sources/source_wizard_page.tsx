/**
 * @fileoverview /sources/new (Modeler): five-step data source wizard —
 * source kind → upload or connect → field mapping (with AI draft) →
 * quality rules → preview & run. Form state is kept across steps; completed
 * steps are checked and revisitable. The source is created (disabled, with
 * a provisional mapping) after step 2 so later steps have a source id, and
 * updated with the final mapping / rules / enabled at the end.
 */

import type {
  QualityRule,
  SourceDef,
  SourceDto,
  SourceKind,
} from '@ontodecide/integration/contract';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {ArrowLeft, ArrowRight, Play, Rocket, Square} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useCompiledModel, useUiModel} from '../../entities/schema/api';
import {errorMessage} from '../../shared/api/error_message';
import {isApiError} from '../../shared/api/errors';
import {qk} from '../../shared/api/query_keys';
import {useOnline} from '../../shared/lib/hooks';
import {track} from '../../shared/lib/telemetry';
import {Button} from '../../shared/ui/button';
import {PageHeader} from '../../shared/ui/page_header';
import {Stepper} from '../../shared/ui/stepper';
import {toast} from '../../shared/ui/toast';
import {useCreateSource, useUpdateSource} from '../../features/integration/api';
import {MappingStep} from '../../features/integration/components/mapping_step';
import {
  ConnectorSummary,
  PreviewStep,
} from '../../features/integration/components/preview_step';
import {QualityStep} from '../../features/integration/components/quality_step';
import {SourceKindStep} from '../../features/integration/components/source_kind_step';
import {UploadStep} from '../../features/integration/components/upload_step';
import type {ParsedFile} from '../../features/integration/parse_client';
import {
  browserUploadDeps,
  planBatches,
  runUpload,
  type UploadProgress,
} from '../../features/integration/upload';
import {
  buildMapping,
  buildRestConfig,
  buildRule,
  emptyDraft,
  emptyRest,
  guessPrimaryKey,
  mappingIssues,
  restIssues,
  ruleIssue,
  syncDraftFields,
  type MappingDraft,
  type RestDraft,
  type RuleRow,
  type SourceSettings,
} from '../../features/integration/wizard';

const STEP_KEYS = ['kind', 'upload', 'mapping', 'quality', 'preview'] as const;

/** The data source wizard page. */
export function SourceWizardPage() {
  const {t} = useTranslation('sources');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const online = useOnline();
  const {model} = useUiModel();
  const compiledModel = useCompiledModel();
  const createSource = useCreateSource();
  const updateSource = useUpdateSource();

  const [step, setStep] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [showIssues, setShowIssues] = useState(false);
  const [kind, setKind] = useState<SourceKind>('file');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [settings, setSettings] = useState<SourceSettings>({
    name: '',
    targetType: '',
    txnType: 'APPEND',
    conflictPolicy: 'latest-wins',
  });
  const [rest, setRest] = useState<RestDraft>(emptyRest);
  const [source, setSource] = useState<SourceDto | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [draft, setDraft] = useState<MappingDraft>(() => emptyDraft([]));
  /** Target type the draft was built for (reset the draft when it changes). */
  const [draftType, setDraftType] = useState('');
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const type = model.byName[settings.targetType];
  const compiled = compiledModel.data?.objectTypes?.[settings.targetType];
  const sampleRows = parsed?.rows ?? [];
  const mapping = useMemo(
    () => buildMapping(draft, settings.targetType, type),
    [draft, settings.targetType, type],
  );
  const qualityRules = useMemo<QualityRule[]>(
    () => rules.filter(r => r.prop).map(buildRule),
    [rules],
  );
  const steps = STEP_KEYS.map(k => t(`wizard.steps.${k}`));
  const running = progress !== null && progress.phase !== 'done' && !runError;

  const goTo = (i: number) => {
    setShowIssues(false);
    setStep(i);
  };
  const complete = (i: number) => setCompleted(prev => new Set(prev).add(i));

  const sourceDef = (): SourceDef => ({
    name: settings.name.trim(),
    kind,
    config:
      kind === 'file'
        ? {format: parsed?.format ?? 'csv'}
        : kind === 'rest'
          ? buildRestConfig(rest)
          : {},
    mapping,
    qualityRules,
    conflictPolicy: settings.conflictPolicy,
  });

  /** Step 2 → create (or update) the source with a provisional mapping. */
  const submitConnection = async () => {
    const fields =
      kind === 'file' ? (parsed?.fields ?? []) : draft.fields.map(f => f.from);
    const valid =
      !!settings.name.trim() &&
      !!settings.targetType &&
      (kind !== 'file' || !!parsed) &&
      (kind !== 'rest' || restIssues(rest).length === 0);
    if (!valid) {
      setShowIssues(true);
      return;
    }
    // Keep the draft when only the file content changed; reset it when the
    // target type changed.
    let next = draft;
    if (draftType !== settings.targetType) {
      next = emptyDraft(
        kind === 'file' ? fields : [],
        guessPrimaryKey(fields, type),
      );
      setRules([]);
    } else if (kind === 'file') {
      next = syncDraftFields(draft, fields);
      if (!next.primaryKey.from || !fields.includes(next.primaryKey.from)) {
        next = {
          ...next,
          primaryKey: {...next.primaryKey, from: guessPrimaryKey(fields, type)},
        };
      }
    }
    const provisional = buildMapping(
      {
        ...emptyDraft(
          [],
          next.primaryKey.from || guessPrimaryKey(fields, type),
        ),
        fields: [],
      },
      settings.targetType,
      type,
    );
    setBusy(true);
    try {
      const def: SourceDef = {
        name: settings.name.trim(),
        kind,
        config:
          kind === 'file'
            ? {format: parsed?.format ?? 'csv'}
            : kind === 'rest'
              ? buildRestConfig(rest)
              : {},
        mapping: source
          ? buildMapping(next, settings.targetType, type)
          : provisional,
        conflictPolicy: settings.conflictPolicy,
        enabled: false,
      };
      if (source && source.kind === kind) {
        const updated = await updateSource.mutateAsync({
          id: source.id,
          patch: def,
        });
        setSource(updated);
      } else {
        const created = await createSource.mutateAsync(def);
        setSource(created);
        if (created.webhookSecret) setWebhookSecret(created.webhookSecret);
        track('source.create');
      }
      setDraft(next);
      setDraftType(settings.targetType);
      complete(1);
      goTo(2);
    } catch (e) {
      toast.error(t('wizard.createFailed'), errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (step === 0) {
      complete(0);
      goTo(1);
    } else if (step === 1) {
      void submitConnection();
    } else if (step === 2) {
      if (
        mappingIssues(draft, settings.targetType, type).some(i => !i.warning)
      ) {
        setShowIssues(true);
        return;
      }
      complete(2);
      goTo(3);
    } else if (step === 3) {
      if (rules.some(r => ruleIssue(r))) {
        setShowIssues(true);
        return;
      }
      complete(3);
      goTo(4);
    }
  };

  const finalize = async () => {
    if (!source) return;
    await updateSource.mutateAsync({
      id: source.id,
      patch: {...sourceDef(), enabled: true},
    });
  };

  /** Step 5 (file): save the final source definition and import the file. */
  const startImport = async () => {
    if (!source || !parsed) return;
    setRunError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      setProgress({
        phase: 'presign',
        archive: 0,
        archiveSkipped: false,
        batchesDone: 0,
        batchesTotal: 0,
        inFlight: 0,
        retrying: 0,
      });
      await finalize();
      const res = await runUpload(
        {
          sourceId: source.id,
          fileName: parsed.name,
          file: parsed.file,
          batches: planBatches(parsed.rows),
          txnType: settings.txnType,
        },
        browserUploadDeps(),
        setProgress,
        ctrl.signal,
      );
      complete(4);
      track('source.import');
      void qc.invalidateQueries({queryKey: qk.jobs()});
      void qc.invalidateQueries({queryKey: qk.jobs(source.id)});
      toast.success(t('preview.started'));
      void navigate({to: '/jobs/$id', params: {id: res.jobId}});
    } catch (e) {
      if (isApiError(e, 'ABORTED')) {
        setProgress(null);
        return;
      }
      setRunError(errorMessage(e, t));
    }
  };

  /** Step 5 (REST / webhook): enable the source. */
  const finishConnector = async () => {
    setBusy(true);
    try {
      await finalize();
      complete(4);
      toast.success(t('summary.created'));
      void navigate({to: '/sources'});
    } catch (e) {
      toast.error(t('wizard.createFailed'), errorMessage(e, t));
    } finally {
      setBusy(false);
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
        title={t('wizard.title')}
        description={t('wizard.description')}
      />
      <div className="glass px-4 py-3">
        <Stepper
          steps={steps}
          current={step}
          completed={completed}
          label={t('wizard.stepperLabel')}
          onSelect={i => {
            if (running) return;
            if (i >= 2 && !source) return;
            goTo(i);
          }}
        />
      </div>

      <section aria-label={steps[step]}>
        {step === 0 && (
          <SourceKindStep value={kind} onChange={k => setKind(k)} />
        )}
        {step === 1 && (
          <UploadStep
            kind={kind}
            parsed={parsed}
            onParsed={setParsed}
            settings={settings}
            onSettings={setSettings}
            rest={rest}
            onRest={setRest}
            types={model.types}
            showIssues={showIssues}
            lockedType={!!draftType && draftType !== settings.targetType}
          />
        )}
        {step === 2 && (
          <MappingStep
            kind={kind}
            draft={draft}
            onDraft={setDraft}
            targetType={settings.targetType}
            type={type}
            compiled={compiled}
            sourceId={source?.id}
            sampleRows={sampleRows}
            showIssues={showIssues}
          />
        )}
        {step === 3 && (
          <QualityStep
            rules={rules}
            onRules={setRules}
            type={type}
            model={model}
            showIssues={showIssues}
          />
        )}
        {step === 4 &&
          (kind === 'file' && parsed ? (
            <PreviewStep
              parsed={parsed}
              mapping={mapping}
              rules={qualityRules}
              compiled={compiled}
              type={type}
              progress={progress}
              error={runError}
            />
          ) : (
            <ConnectorSummary
              kind={kind}
              name={settings.name}
              mapping={mapping}
              rules={qualityRules}
              webhookSecret={webhookSecret}
              sourceId={source?.id}
              type={type}
            />
          ))}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <Button
          variant="ghost"
          onClick={() => goTo(step - 1)}
          disabled={step === 0 || running || busy}
        >
          <ArrowLeft aria-hidden />
          {t('common:actions.previous')}
        </Button>
        <div className="flex items-center gap-2">
          {step < 4 && (
            <Button
              variant="primary"
              onClick={next}
              loading={busy}
              disabled={!online && step === 1}
            >
              {t('common:actions.next')}
              <ArrowRight aria-hidden />
            </Button>
          )}
          {step === 4 && kind === 'file' && (
            <>
              {running && (
                <Button
                  variant="ghost"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square aria-hidden />
                  {t('preview.cancel')}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => void startImport()}
                loading={running}
                disabled={!online || !parsed || !compiled}
              >
                <Play aria-hidden />
                {runError ? t('preview.retryImport') : t('preview.start')}
              </Button>
            </>
          )}
          {step === 4 && kind !== 'file' && (
            <Button
              variant="primary"
              onClick={() => void finishConnector()}
              loading={busy}
              disabled={!online}
            >
              <Rocket aria-hidden />
              {t('summary.finish')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
