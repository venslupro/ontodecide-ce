/**
 * @fileoverview New import wizard (/imports/new, 前端详细设计 数据导入):
 * 选择来源 → 上传文件 → 字段映射 → 校验 → 预览与运行. The file is parsed in
 * the browser; only mapped JSON rows are submitted in batches of ≤ 100.
 * Completed steps are checked and revisitable; the title area shows the
 * file name and row count.
 */

import type {JobDto} from '@ontodecide/integration/contract';
import {CE_LIMITS} from '@ontodecide/shared-kernel';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {remaining, useQuotas} from '../../entities/quota';
import {useUiModel} from '../../entities/schema/api';
import {
  createImport,
  getImport,
  integrationKeys,
  putMapping,
  requestMappingDraft,
  submitBatch,
} from '../../features/integration/api';
import {
  MappingStep,
  type DraftError,
  type DraftInfo,
} from '../../features/integration/components/mapping_step';
import {PreviewStep} from '../../features/integration/components/preview_step';
import {SourceStep} from '../../features/integration/components/source_kind_step';
import {UploadStep} from '../../features/integration/components/upload_step';
import {ValidateStep} from '../../features/integration/components/validate_step';
import {
  applyDraft,
  autoMatch,
  fieldStatus,
  mappingProblems,
  toMappingSpec,
  usedColumns,
  type FieldMapping,
} from '../../features/integration/mapping';
import type {ParsedFile} from '../../features/integration/parse_client';
import {WIZARD_STEPS} from '../../features/integration/wizard';
import {
  planUpload,
  projectRows,
  rowLinkCounts,
  validateRows,
  type PlanQuota,
} from '../../features/integration/preview';
import {
  abortableSleep,
  newUploadState,
  runUpload,
  type UploadDeps,
  type UploadProgress,
  type UploadState,
} from '../../features/integration/upload';
import {qk} from '../../shared/api/query_keys';
import {useRetryAfter} from '../../shared/api/rate_limit';
import {Button} from '../../shared/ui/button';
import {PageHeader} from '../../shared/ui/page_header';
import {Stepper} from '../../shared/ui/stepper';
import type {FileFormat} from '../../workers/parse_core';

const STEP_KEYS = WIZARD_STEPS;

const UPLOAD_DEPS: UploadDeps = {
  createImport,
  putMapping,
  submitBatch,
  getImport,
  sleep: abortableSleep,
};

/** Job created for the AI draft, keyed by what it was created for. */
interface DraftJob {
  job: JobDto;
  key: string;
}

/** Import wizard page. */
export function ImportWizardPage() {
  const {t} = useTranslation('imports');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {model, isLoading} = useUiModel();
  const {quotas} = useQuotas();

  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [format, setFormat] = useState<FileFormat>('csv');
  const [targetType, setTargetType] = useState('');
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [rows, setRows] = useState<FieldMapping[]>([]);
  const [draftJob, setDraftJob] = useState<DraftJob | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<DraftError | null>(null);
  const [draftInfo, setDraftInfo] = useState<DraftInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [runError, setRunError] = useState<unknown>(null);
  const upload = useRef<UploadState | null>(null);
  const abort = useRef<AbortController | null>(null);
  const runLimit = useRetryAfter('import.batch');

  const type = targetType ? model.byName[targetType] : undefined;
  const jobKey = file ? `${file.name}|${file.rows.length}|${targetType}` : '';
  const job = draftJob?.key === jobKey ? draftJob.job : null;

  // Rows reserved by a job created for the AI draft count as available.
  const quota: PlanQuota = {
    importRowsLeft: quotas
      ? remaining(quotas.importRowsToday) + (job?.totalRows ?? 0)
      : CE_LIMITS.importRowsDaily,
    objectsLeft: quotas ? remaining(quotas.objects) : CE_LIMITS.objects,
    linksLeft: quotas ? remaining(quotas.links) : CE_LIMITS.links,
  };
  const problems = type ? mappingProblems(rows, type) : [];
  const spec = useMemo(
    () => (type ? toMappingSpec(rows, type) : null),
    [rows, type],
  );
  // Link headroom counts only for mappings with links.
  const linkCounts = useMemo(
    () => (file && spec ? rowLinkCounts(file.rows, spec) : []),
    [file, spec],
  );
  // A job created for the AI draft reserved its rows: they are the cap.
  const plan = planUpload(
    file?.rows.length ?? 0,
    job ? {...quota, importRowsLeft: job.totalRows} : quota,
    undefined,
    linkCounts,
  );
  const validating = step >= 3 && problems.length === 0;
  const submitRows = plan.submitRows;
  const summary = useMemo(
    () =>
      validating && file && type && spec
        ? validateRows(file.rows, spec, type, {submitRows})
        : null,
    [validating, file, type, spec, submitRows],
  );

  const resetMapping = (f: ParsedFile | null, ty: string) => {
    const ut = ty ? model.byName[ty] : undefined;
    setRows(f && ut ? autoMatch(f.fields, ut, model, f.sampleRows) : []);
    setDraftInfo(null);
    setDraftError(null);
    upload.current = null;
    setProgress(null);
    setRunError(null);
    setReached(r => Math.min(r, f ? 2 : 1));
  };

  const canNext = [!!type, !!file, problems.length === 0, !!summary, false];
  const completed = new Set<number>();
  for (let i = 0; i < STEP_KEYS.length - 1; i++) {
    if (i < reached && canNext.slice(0, i + 1).every(Boolean)) completed.add(i);
  }
  const labels = STEP_KEYS.map(k => t(`wizard.steps.${k}`));
  const go = (i: number) => {
    setStep(i);
    setReached(r => Math.max(r, i));
  };

  const onDraft = async () => {
    if (!file || !type) return;
    setDraftBusy(true);
    setDraftError(null);
    let quotaKey: DraftError['quota'] = 'importRowsToday';
    try {
      let id = job?.id;
      if (!id) {
        const created = await createImport({
          fileName: file.name,
          targetType: type.apiName,
          totalRows: plan.submitRows,
        });
        setDraftJob({job: created, key: jobKey});
        upload.current = newUploadState(created.id);
        id = created.id;
      }
      quotaKey = 'mappingDraftsToday';
      const fields = file.fields.slice(0, 100);
      const draft = await requestMappingDraft(id, {
        fields,
        sampleRows: file.sampleRows
          .slice(0, 20)
          .map(r => fields.map(f => r[f] ?? null)),
        targetType: type.apiName,
      });
      const next = applyDraft(rows, draft, type, model);
      setRows(next);
      setDraftInfo({
        rankedBy: draft.rankedBy,
        aiCount: next.filter(r => fieldStatus(r) === 'ai').length,
      });
    } catch (e) {
      setDraftError({error: e, quota: quotaKey});
    } finally {
      setDraftBusy(false);
      void qc.invalidateQueries({queryKey: qk.me()});
    }
  };

  const onRun = async () => {
    if (!file || !spec || runLimit.limited) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    upload.current ??= newUploadState(job?.id ?? null);
    setRunning(true);
    setRunError(null);
    try {
      const final = await runUpload(
        {
          fileName: file.name,
          mapping: spec,
          rows: projectRows(
            file.rows.slice(0, plan.submitRows),
            usedColumns(spec),
          ),
        },
        UPLOAD_DEPS,
        upload.current,
        {signal: ctrl.signal, onProgress: setProgress},
      );
      qc.setQueryData(integrationKeys.job(final.id), final);
      void qc.invalidateQueries({queryKey: integrationKeys.imports()});
      void qc.invalidateQueries({queryKey: ['object']});
      void navigate({to: '/imports/$id', params: {id: final.id}});
    } catch (e) {
      runLimit.trap(e);
      setRunError(e);
    } finally {
      setRunning(false);
      void qc.invalidateQueries({queryKey: qk.me()});
    }
  };

  const canResume = !!upload.current && upload.current.next > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={
          <Link to="/imports" className="hover:text-text">
            {t('wizard.breadcrumb')}
          </Link>
        }
        title={t('wizard.title')}
        actions={
          file && (
            <span className="num text-sm text-muted">
              {t('wizard.fileMeta', {name: file.name, rows: file.rows.length})}
            </span>
          )
        }
      />
      <nav className="glass px-4 py-3">
        <Stepper
          steps={labels}
          current={step}
          completed={completed}
          onSelect={i => !running && setStep(i)}
          label={t('wizard.stepsLabel')}
        />
      </nav>
      <section
        className="glass flex flex-col gap-4 p-4"
        aria-label={labels[step]}
      >
        {step === 0 &&
          (isLoading ? (
            <p className="text-sm text-muted">{t('wizard.typeLoading')}</p>
          ) : (
            <SourceStep
              format={format}
              onFormat={setFormat}
              targetType={targetType}
              onTargetType={ty => {
                setTargetType(ty);
                resetMapping(file, ty);
              }}
              types={model.types}
            />
          ))}
        {step === 1 && (
          <UploadStep
            parsed={file}
            onParsed={f => {
              setFile(f);
              setFormat(f.format);
              resetMapping(f, targetType);
            }}
          />
        )}
        {step === 2 && file && type && (
          <MappingStep
            file={file}
            type={type}
            model={model}
            rows={rows}
            onRows={r => {
              setRows(r);
              const u = upload.current;
              if (u && u.next > 0) {
                // Batches were received: the job's mapping is final.
                upload.current = null;
                setDraftJob(null);
              } else if (u) {
                u.mappingSet = false;
              }
            }}
            onDraft={() => void onDraft()}
            draftBusy={draftBusy}
            draftError={draftError}
            draftInfo={draftInfo}
            canDraft={plan.submitRows > 0 || !!job}
          />
        )}
        {step === 3 && summary && (
          <ValidateStep summary={summary} plan={plan} quota={quota} />
        )}
        {step === 4 && summary && spec && (
          <PreviewStep
            summary={summary}
            spec={spec}
            plan={plan}
            importRows={{
              left: quota.importRowsLeft,
              limit: quotas?.importRowsToday.limit ?? CE_LIMITS.importRowsDaily,
            }}
            running={running}
            progress={progress}
            runError={runError}
            canResume={canResume}
            retryIn={runLimit.seconds}
            onRun={() => void onRun()}
            onCancel={() => abort.current?.abort()}
          />
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          {step > 0 && (
            <Button
              variant="outline"
              disabled={running}
              onClick={() => setStep(step - 1)}
            >
              {step === 3 ? t('validate.backToMapping') : t('wizard.back')}
            </Button>
          )}
          {step < STEP_KEYS.length - 1 && (
            <Button
              variant="primary"
              disabled={!canNext[step]}
              onClick={() => go(step + 1)}
            >
              {t('wizard.nextTo', {step: labels[step + 1]})}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
