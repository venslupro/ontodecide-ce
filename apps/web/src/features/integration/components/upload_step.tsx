/**
 * @fileoverview Wizard step 2: upload a file (parsed in the Web Worker) or
 * describe the REST / webhook connection, then choose the target object
 * type, source name, transaction type and conflict policy.
 */

import {
  INGEST_LIMITS,
  type ConflictPolicy,
  type SourceKind,
  type TxnType,
} from '@ontodecide/integration/contract';
import {
  AlertOctagon,
  Clock,
  FileText,
  KeyRound,
  Plus,
  Rows3,
  Trash2,
  UploadCloud,
  Weight,
} from 'lucide-react';
import {useEffect, useRef, useState, type DragEvent} from 'react';
import {useTranslation} from 'react-i18next';
import type {UiObjectType} from '../../../entities/schema/model';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {Button} from '../../../shared/ui/button';
import {Panel} from '../../../shared/ui/card';
import {Checkbox, Field, Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Spinner} from '../../../shared/ui/skeleton';
import {
  parseInBrowser,
  ParseFailure,
  type ParsedFile,
  type ParseHandle,
} from '../parse_client';
import {
  restIssues,
  rowId,
  type RestDraft,
  type SourceSettings,
} from '../wizard';
import {SampleTable} from './sample_table';

const ACCEPT =
  '.csv,.xlsx,.xls,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MB = 1024 * 1024;

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes >= MB)
    return `${fmt.number(bytes / MB, {maximumFractionDigits: 1})} MB`;
  if (bytes >= 1024)
    return `${fmt.number(bytes / 1024, {maximumFractionDigits: 1})} KB`;
  return `${fmt.number(bytes)} B`;
}

/** File drop zone + parse summary. */
function FileUpload({
  parsed,
  onParsed,
}: {
  parsed: ParsedFile | null;
  onParsed: (p: ParsedFile | null) => void;
}) {
  const {t} = useTranslation('sources');
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState<{name: string; rows: number} | null>(
    null,
  );
  const [error, setError] = useState<{code: string; detail?: string} | null>(
    null,
  );
  const handleRef = useRef<ParseHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => handleRef.current?.cancel(), []);

  const start = (file: File | undefined) => {
    if (!file) return;
    handleRef.current?.cancel();
    setError(null);
    setParsing({name: file.name, rows: 0});
    const h = parseInBrowser(file, {
      onProgress: rows => setParsing({name: file.name, rows}),
    });
    handleRef.current = h;
    h.promise.then(
      p => {
        if (handleRef.current !== h) return;
        setParsing(null);
        onParsed(p);
      },
      (e: unknown) => {
        if (handleRef.current !== h) return;
        setParsing(null);
        if (e instanceof ParseFailure && e.detail === 'cancelled') return;
        setError(
          e instanceof ParseFailure
            ? {code: e.code, detail: e.detail}
            : {code: 'PARSE_FAILED', detail: String(e)},
        );
      },
    );
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    start(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed px-6 py-8 text-center transition-colors',
          dragging
            ? 'border-cyan bg-cyan/10'
            : 'border-line-2 bg-panel-2/40 hover:border-cyan/50',
        )}
      >
        <UploadCloud
          className={cn('size-8', dragging ? 'text-cyan' : 'text-dim')}
          aria-hidden
        />
        <span className="text-sm font-medium text-text">
          {t('upload.dropTitle')}
        </span>
        <span className="text-xs text-muted">
          {t('upload.dropHint', {
            maxMb: INGEST_LIMITS.fileBytesMax / MB,
            maxRows: INGEST_LIMITS.fileRowsMax,
          })}
        </span>
        <span className="mt-1 inline-flex h-7 items-center rounded-[var(--radius-btn)] border border-line-2 bg-panel-2 px-2.5 text-xs text-text">
          {t('upload.choose')}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label={t('upload.fileInput')}
          onChange={e => {
            start(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>

      {parsing && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/60 px-3 py-2 text-sm"
        >
          <Spinner />
          <span className="text-muted">
            {t('upload.parsing', {name: parsing.name, rows: parsing.rows})}
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit"
        >
          <AlertOctagon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              {t(`upload.errors.${error.code}`, {
                maxMb: INGEST_LIMITS.fileBytesMax / MB,
                maxRows: INGEST_LIMITS.fileRowsMax,
                defaultValue: t('upload.errors.PARSE_FAILED'),
              })}
            </p>
            {error.detail && error.code === 'PARSE_FAILED' && (
              <p className="mt-0.5 text-xs opacity-80">{error.detail}</p>
            )}
          </div>
        </div>
      )}

      {parsed && !parsing && (
        <div className="flex flex-col gap-3">
          <dl
            aria-label={t('upload.summary')}
            className="grid grid-cols-2 gap-2 md:grid-cols-4"
          >
            {[
              {
                icon: <FileText aria-hidden />,
                label: t('upload.fileName'),
                value: parsed.name,
              },
              {
                icon: <Weight aria-hidden />,
                label: t('upload.size'),
                value: formatBytes(parsed.size),
              },
              {
                icon: <Rows3 aria-hidden />,
                label: t('upload.rows'),
                value: t('upload.rowsValue', {count: parsed.rows.length}),
              },
              {
                icon: <Clock aria-hidden />,
                label: t('upload.parseTime'),
                value: t('upload.ms', {ms: parsed.ms}),
              },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-lg border border-line bg-panel-2/50 px-3 py-2"
              >
                <dt className="flex items-center gap-1.5 text-[11px] text-dim [&_svg]:size-3.5">
                  {item.icon}
                  {item.label}
                </dt>
                <dd
                  className="num mt-0.5 truncate text-sm font-medium text-text"
                  title={item.value}
                >
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {t('upload.fieldsDetected', {
                count: parsed.fields.length,
                format: parsed.format.toUpperCase(),
              })}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onParsed(null);
                inputRef.current?.click();
              }}
            >
              {t('upload.replace')}
            </Button>
          </div>
          <SampleTable
            fields={parsed.fields}
            rows={parsed.sampleRows}
            caption={t('upload.sample')}
          />
        </div>
      )}
    </div>
  );
}

/** REST pull connection form. */
function RestForm({
  value,
  onChange,
  showIssues,
}: {
  value: RestDraft;
  onChange: (d: RestDraft) => void;
  showIssues: boolean;
}) {
  const {t} = useTranslation('sources');
  const issues = showIssues ? restIssues(value) : [];
  const set = (patch: Partial<RestDraft>) => onChange({...value, ...patch});
  return (
    <div className="grid grid-cols-12 gap-3.5">
      <Field
        label={t('rest.url')}
        htmlFor="rest-url"
        required
        className="col-span-12 md:col-span-9"
        error={
          issues.includes('rest.issues.url') ? t('rest.issues.url') : undefined
        }
      >
        <Input
          id="rest-url"
          value={value.url}
          onChange={e => set({url: e.target.value})}
          placeholder="https://erp.example.com/api/suppliers"
          aria-invalid={issues.includes('rest.issues.url')}
        />
      </Field>
      <Field
        label={t('rest.method')}
        htmlFor="rest-method"
        className="col-span-12 md:col-span-3"
      >
        <NativeSelect
          id="rest-method"
          value={value.method}
          onChange={e => set({method: e.target.value as RestDraft['method']})}
          options={[
            {value: 'GET', label: 'GET'},
            {value: 'POST', label: 'POST'},
          ]}
        />
      </Field>
      <Field
        label={t('rest.itemsPath')}
        htmlFor="rest-items"
        required
        hint={t('rest.itemsPathHint')}
        className="col-span-12 md:col-span-4"
        error={
          issues.includes('rest.issues.itemsPath')
            ? t('rest.issues.itemsPath')
            : undefined
        }
      >
        <Input
          id="rest-items"
          className="font-mono"
          value={value.itemsPath}
          onChange={e => set({itemsPath: e.target.value})}
        />
      </Field>
      <Field
        label={t('rest.cursorParam')}
        htmlFor="rest-cursor-param"
        hint={t('rest.cursorParamHint')}
        className="col-span-12 md:col-span-4"
      >
        <Input
          id="rest-cursor-param"
          className="font-mono"
          value={value.cursorParam}
          onChange={e => set({cursorParam: e.target.value})}
          placeholder="since"
        />
      </Field>
      <Field
        label={t('rest.cursorPath')}
        htmlFor="rest-cursor-path"
        hint={t('rest.cursorPathHint')}
        className="col-span-12 md:col-span-4"
      >
        <Input
          id="rest-cursor-path"
          className="font-mono"
          value={value.cursorPath}
          onChange={e => set({cursorPath: e.target.value})}
          placeholder="$.next"
        />
      </Field>
      <div className="col-span-12 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">
            {t('rest.headers')}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              set({
                headers: [
                  ...value.headers,
                  {id: rowId('h'), key: '', value: '', secret: false},
                ],
              })
            }
          >
            <Plus aria-hidden />
            {t('rest.addHeader')}
          </Button>
        </div>
        {value.headers.length === 0 && (
          <p className="text-xs text-dim">{t('rest.noHeaders')}</p>
        )}
        {value.headers.map((h, i) => (
          <div key={h.id} className="flex flex-wrap items-center gap-2">
            <Input
              inputSize="sm"
              className="w-44 font-mono"
              value={h.key}
              aria-label={t('rest.headerKey', {n: i + 1})}
              placeholder="Authorization"
              onChange={e =>
                set({
                  headers: value.headers.map(x =>
                    x.id === h.id ? {...x, key: e.target.value} : x,
                  ),
                })
              }
            />
            <Input
              inputSize="sm"
              className="min-w-40 flex-1 font-mono"
              type={h.secret ? 'password' : 'text'}
              autoComplete="off"
              value={h.value}
              aria-label={t('rest.headerValue', {n: i + 1})}
              onChange={e =>
                set({
                  headers: value.headers.map(x =>
                    x.id === h.id ? {...x, value: e.target.value} : x,
                  ),
                })
              }
            />
            <label className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted">
              <Checkbox
                checked={h.secret}
                onCheckedChange={c =>
                  set({
                    headers: value.headers.map(x =>
                      x.id === h.id ? {...x, secret: c === true} : x,
                    ),
                  })
                }
              />
              <KeyRound className="size-3.5" aria-hidden />
              {t('rest.secret')}
            </label>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('rest.removeHeader', {n: i + 1})}
              onClick={() =>
                set({headers: value.headers.filter(x => x.id !== h.id)})
              }
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <p className="text-[11px] text-dim">{t('rest.secretHint')}</p>
      </div>
    </div>
  );
}

/** Target type / name / transaction settings. */
function SettingsForm({
  kind,
  value,
  onChange,
  types,
  showIssues,
  lockedType,
}: {
  kind: SourceKind;
  value: SourceSettings;
  onChange: (s: SourceSettings) => void;
  types: UiObjectType[];
  showIssues: boolean;
  lockedType?: boolean;
}) {
  const {t} = useTranslation('sources');
  const set = (patch: Partial<SourceSettings>) =>
    onChange({...value, ...patch});
  return (
    <div className="grid grid-cols-12 gap-3.5">
      <Field
        label={t('settings.name')}
        htmlFor="source-name"
        required
        className="col-span-12 md:col-span-6"
        error={
          showIssues && !value.name.trim()
            ? t('settings.nameRequired')
            : undefined
        }
      >
        <Input
          id="source-name"
          value={value.name}
          maxLength={100}
          onChange={e => set({name: e.target.value})}
          aria-invalid={showIssues && !value.name.trim()}
        />
      </Field>
      <Field
        label={t('settings.targetType')}
        htmlFor="source-target"
        required
        className="col-span-12 md:col-span-6"
        hint={lockedType ? t('settings.targetTypeChangeHint') : undefined}
        error={
          showIssues && !value.targetType
            ? t('settings.targetTypeRequired')
            : undefined
        }
      >
        <NativeSelect
          id="source-target"
          value={value.targetType}
          placeholder={t('settings.chooseType')}
          onChange={e => set({targetType: e.target.value})}
          options={types.map(tp => ({
            value: tp.apiName,
            label: `${tp.displayName} (${tp.apiName})`,
          }))}
          aria-invalid={showIssues && !value.targetType}
        />
      </Field>
      {kind === 'file' && (
        <Field
          label={t('settings.txnType')}
          htmlFor="source-txn"
          hint={t(`settings.txnHint.${value.txnType}`)}
          className="col-span-12 md:col-span-6"
        >
          <NativeSelect
            id="source-txn"
            value={value.txnType}
            onChange={e => set({txnType: e.target.value as TxnType})}
            options={(['APPEND', 'SNAPSHOT'] as const).map(v => ({
              value: v,
              label: t(`settings.txn.${v}`),
            }))}
          />
        </Field>
      )}
      <Field
        label={t('settings.conflictPolicy')}
        htmlFor="source-conflict"
        hint={t(`settings.conflictHint.${value.conflictPolicy}`)}
        className="col-span-12 md:col-span-6"
      >
        <NativeSelect
          id="source-conflict"
          value={value.conflictPolicy}
          onChange={e =>
            set({conflictPolicy: e.target.value as ConflictPolicy})
          }
          options={(
            ['latest-wins', 'source-priority', 'max-confidence'] as const
          ).map(v => ({
            value: v,
            label: t(`settings.conflict.${v}`),
          }))}
        />
      </Field>
    </div>
  );
}

/** Step 2 container. */
export function UploadStep({
  kind,
  parsed,
  onParsed,
  settings,
  onSettings,
  rest,
  onRest,
  types,
  showIssues,
  lockedType,
}: {
  kind: SourceKind;
  parsed: ParsedFile | null;
  onParsed: (p: ParsedFile | null) => void;
  settings: SourceSettings;
  onSettings: (s: SourceSettings) => void;
  rest: RestDraft;
  onRest: (d: RestDraft) => void;
  types: UiObjectType[];
  showIssues: boolean;
  lockedType?: boolean;
}) {
  const {t} = useTranslation('sources');
  return (
    <div className="grid grid-cols-12 gap-3.5">
      <Panel
        className="col-span-12"
        title={t(`upload.title.${kind}`)}
        subtitle={t(`upload.subtitle.${kind}`)}
      >
        {kind === 'file' && (
          <>
            <FileUpload
              parsed={parsed}
              onParsed={p => {
                onParsed(p);
                if (p && !settings.name.trim())
                  onSettings({...settings, name: p.name});
              }}
            />
            {showIssues && !parsed && (
              <p role="alert" className="mt-2 text-xs text-crit">
                {t('upload.fileRequired')}
              </p>
            )}
          </>
        )}
        {kind === 'rest' && (
          <RestForm value={rest} onChange={onRest} showIssues={showIssues} />
        )}
        {kind === 'webhook' && (
          <div className="flex items-start gap-3 rounded-lg border border-violet/30 bg-violet/10 px-4 py-3">
            <KeyRound
              className="mt-0.5 size-5 shrink-0 text-violet"
              aria-hidden
            />
            <div className="text-sm">
              <p className="font-medium text-text">
                {t('webhook.noticeTitle')}
              </p>
              <p className="mt-1 text-xs text-muted">{t('webhook.notice')}</p>
            </div>
          </div>
        )}
      </Panel>
      <Panel
        className="col-span-12"
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      >
        <SettingsForm
          kind={kind}
          value={settings}
          onChange={onSettings}
          types={types}
          showIssues={showIssues}
          lockedType={lockedType}
        />
      </Panel>
    </div>
  );
}
