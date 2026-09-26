/**
 * @fileoverview Wizard step 3: field mapping. Left: source fields with
 * sample values; right: target property (from the schema, required props
 * marked) and a transform chain. Optional links and source timestamp.
 * "AI 生成映射草稿" attaches suggestions that stay inert (AI badge +
 * confidence) until the user confirms each row or accepts all. A live
 * mapping preview shows the first sample row mapped with confirmed rows.
 */

import type {MappingSuggestion} from '@ontodecide/decision/contract';
import type {SourceKind} from '@ontodecide/integration/contract';
import type {CompiledObjectType} from '@ontodecide/ontology/contract';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  KeyRound,
  Link2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {UiObjectType} from '../../../entities/schema/model';
import {qk} from '../../../shared/api/query_keys';
import {errorMessage} from '../../../shared/api/error_message';
import {cn} from '../../../shared/lib/cn';
import {fmt} from '../../../shared/lib/format';
import {useOnline} from '../../../shared/lib/hooks';
import {AiBadge, Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Panel} from '../../../shared/ui/card';
import {Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {toast} from '../../../shared/ui/toast';
import {useLlmQuota} from '../../decision/api';
import {suggestMapping} from '../api';
import {previewRow} from '../preview';
import {
  acceptAi,
  acceptAiPrimaryKey,
  acceptAllAi,
  applySuggestion,
  autoMatch,
  buildMapping,
  dismissAi,
  dismissAiPrimaryKey,
  mappingIssues,
  pendingAiCount,
  rowId,
  sampleArrays,
  sampleValues,
  type FieldRow,
  type MappingDraft,
} from '../wizard';
import {
  TransformChainEditor,
  TransformDatalist,
} from './transform_chain_editor';

function display(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Live preview of the first sample row mapped with confirmed rows only. */
function MappingPreview({
  draft,
  targetType,
  type,
  compiled,
  rows,
}: {
  draft: MappingDraft;
  targetType: string;
  type?: UiObjectType;
  compiled?: CompiledObjectType;
  rows: readonly Record<string, unknown>[];
}) {
  const {t} = useTranslation('sources');
  const spec = buildMapping(draft, targetType, type);
  const first = rows[0];
  const res =
    first && compiled && spec.primaryKey.from
      ? previewRow(first, 1, {
          mapping: spec,
          rules: [],
          targetType: compiled,
          now: new Date(),
        })
      : null;
  const propName = (api: string) =>
    type?.properties.find(p => p.apiName === api)?.displayName ?? api;
  return (
    <Panel
      aria-label={t('mapping.preview.title')}
      title={t('mapping.preview.title')}
      subtitle={t('mapping.preview.subtitle', {count: spec.fields.length})}
      className="col-span-12 xl:col-span-4"
    >
      {!first || !compiled ? (
        <p className="text-xs text-dim">{t('mapping.preview.noSample')}</p>
      ) : !res ? (
        <p className="text-xs text-dim">{t('mapping.issues.pkMissing')}</p>
      ) : !res.ok ? (
        <div
          role="status"
          className="rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-xs text-crit"
        >
          <p className="font-mono font-medium">{res.code}</p>
          <p className="mt-0.5 break-words">{res.detail}</p>
        </div>
      ) : (
        <dl className="flex flex-col divide-y divide-line text-xs">
          <div className="flex items-center justify-between gap-3 py-1.5">
            <dt className="flex items-center gap-1 text-muted">
              <KeyRound className="size-3 text-cyan" aria-hidden />
              {t('mapping.primaryKey')}
            </dt>
            <dd className="num font-mono text-text">{res.primaryKey}</dd>
          </div>
          {Object.entries(res.props)
            .filter(
              ([k]) =>
                k !== type?.primaryKey || spec.fields.some(f => f.to === k),
            )
            .map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <dt className="text-muted">{propName(k)}</dt>
                <dd
                  className="num max-w-[60%] truncate text-right font-mono text-text"
                  title={display(v)}
                >
                  {display(v)}
                </dd>
              </div>
            ))}
          {res.links.length > 0 && (
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="flex items-center gap-1 text-muted">
                <Link2 className="size-3" aria-hidden />
                {t('mapping.links.title')}
              </dt>
              <dd className="text-text">
                {res.links.map(l => l.toKey).join(', ')}
              </dd>
            </div>
          )}
        </dl>
      )}
    </Panel>
  );
}

/** Pending / accepted AI suggestion strip below a mapping row. */
function AiStrip({
  row,
  propLabel,
  onAccept,
  onDismiss,
}: {
  row: FieldRow;
  propLabel: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const {t} = useTranslation('sources');
  if (!row.ai) return null;
  const pct = fmt.percent(row.ai.confidence);
  if (row.ai.status === 'accepted') {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        <AiBadge />
        <span>{t('mapping.ai.confidence', {value: pct})}</span>
        <Badge tone="good">
          <Check aria-hidden />
          {t('mapping.ai.confirmed')}
        </Badge>
      </div>
    );
  }
  return (
    <div
      data-testid={`ai-suggestion-${row.from}`}
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-violet/50 bg-violet/5 px-2 py-1 text-[11px]"
    >
      <AiBadge />
      <span className="text-muted">{t('mapping.ai.suggests')}</span>
      <ArrowRight className="size-3 text-violet" aria-hidden />
      <span className="font-medium text-text">{propLabel}</span>
      {row.ai.transform && (
        <code className="rounded bg-panel-2 px-1 font-mono text-violet">
          {row.ai.transform}
        </code>
      )}
      <span className="num text-dim">
        {t('mapping.ai.confidence', {value: pct})}
      </span>
      <span className="ml-auto flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          className="h-6"
          onClick={onAccept}
          aria-label={t('mapping.ai.acceptRow', {field: row.from})}
        >
          <Check aria-hidden />
          {t('mapping.ai.accept')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6"
          onClick={onDismiss}
          aria-label={t('mapping.ai.dismissRow', {field: row.from})}
        >
          <X aria-hidden />
          {t('mapping.ai.dismiss')}
        </Button>
      </span>
    </div>
  );
}

/** Step 3 container. */
export function MappingStep({
  kind,
  draft,
  onDraft,
  targetType,
  type,
  compiled,
  sourceId,
  sampleRows,
  showIssues,
}: {
  kind: SourceKind;
  draft: MappingDraft;
  onDraft: (d: MappingDraft) => void;
  targetType: string;
  type?: UiObjectType;
  compiled?: CompiledObjectType;
  sourceId: string | undefined;
  sampleRows: readonly Record<string, unknown>[];
  showIssues: boolean;
}) {
  const {t} = useTranslation('sources');
  const qc = useQueryClient();
  const online = useOnline();
  const quota = useLlmQuota();
  const [newField, setNewField] = useState('');
  const fields = draft.fields.map(f => f.from);
  const freeText = kind !== 'file';
  const issues = mappingIssues(draft, targetType, type);
  const pending = pendingAiCount(draft);
  const remaining = quota.data?.userRemaining;
  const outgoing = type?.links.filter(l => l.from === targetType) ?? [];

  const suggest = useMutation({
    mutationFn: () =>
      suggestMapping(sourceId!, {
        fields,
        rows: sampleArrays(fields, sampleRows, 20),
        targetType,
      }),
    onSuccess: (s: MappingSuggestion) => {
      onDraft(applySuggestion(draft, s, type));
      toast.info(
        t('mapping.ai.done', {count: s.fields.length}),
        t('common:ai.hint'),
      );
      void qc.invalidateQueries({queryKey: qk.llmQuota()});
    },
    onError: e => {
      toast.error(t('mapping.ai.failed'), errorMessage(e, t));
      void qc.invalidateQueries({queryKey: qk.llmQuota()});
    },
  });

  const propOptions = (type?.properties ?? []).map(p => ({
    value: p.apiName,
    label: `${p.displayName}${p.required ? ' *' : ''}${p.apiName === type?.primaryKey ? ` · ${t('mapping.pkTag')}` : ''} (${p.apiName})`,
  }));
  const propLabel = (api: string) =>
    type?.properties.find(p => p.apiName === api)?.displayName ?? api;
  const fieldOptions = fields.map(f => ({value: f, label: f}));

  const setRow = (from: string, patch: Partial<FieldRow>) =>
    onDraft({
      ...draft,
      // A manual edit of the target replaces any pending AI suggestion.
      fields: draft.fields.map(r =>
        r.from === from
          ? {
              ...r,
              ...patch,
              ...('to' in patch && r.ai?.status === 'pending'
                ? {ai: undefined}
                : {}),
            }
          : r,
      ),
    });

  const aiDisabledReason = !sourceId
    ? t('mapping.ai.noSource')
    : sampleRows.length === 0
      ? t('mapping.ai.noSample')
      : remaining === 0
        ? t('mapping.ai.noQuota')
        : !online
          ? t('common:banner.offline')
          : null;

  return (
    <div className="grid grid-cols-12 gap-3.5">
      <TransformDatalist />
      <Panel
        className="col-span-12 xl:col-span-8"
        title={t('mapping.title')}
        subtitle={t('mapping.subtitle', {
          type: type?.displayName ?? targetType,
        })}
        actions={
          <>
            {type && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDraft(autoMatch(draft, type))}
              >
                <Wand2 aria-hidden />
                {t('mapping.autoMatch')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="border-violet/50 text-violet hover:border-violet hover:text-violet"
              onClick={() => suggest.mutate()}
              loading={suggest.isPending}
              disabled={!!aiDisabledReason}
              title={aiDisabledReason ?? t('common:ai.hint')}
            >
              <Sparkles aria-hidden />
              {t('mapping.ai.generate')}
            </Button>
            {remaining !== undefined && (
              <span
                className="text-[11px] whitespace-nowrap text-dim"
                aria-live="polite"
              >
                {t('common:ai.remaining', {count: remaining})}
              </span>
            )}
          </>
        }
      >
        {pending > 0 && (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-violet/40 bg-violet/10 px-3 py-2 text-xs"
          >
            <AiBadge />
            <span className="text-text">
              {t('mapping.ai.pendingNotice', {count: pending})}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={() => onDraft(acceptAllAi(draft))}
            >
              <Check aria-hidden />
              {t('mapping.ai.acceptAll')}
            </Button>
          </div>
        )}

        {/* Primary key row */}
        <div className="mb-3 grid grid-cols-12 items-start gap-3 rounded-lg border border-cyan/30 bg-cyan/5 p-3">
          <div className="col-span-12 flex items-center gap-2 md:col-span-4">
            <KeyRound className="size-4 text-cyan" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-text">
                {t('mapping.primaryKey')}
              </p>
              <p className="text-[11px] text-muted">
                {t('mapping.primaryKeyHint', {
                  prop: type ? propLabel(type.primaryKey) : '—',
                })}
              </p>
            </div>
          </div>
          <div className="col-span-12 md:col-span-3">
            {freeText ? (
              <Input
                inputSize="sm"
                value={draft.primaryKey.from}
                aria-label={t('mapping.primaryKeySource')}
                onChange={e =>
                  onDraft({
                    ...draft,
                    primaryKey: {...draft.primaryKey, from: e.target.value},
                  })
                }
              />
            ) : (
              <NativeSelect
                size="sm"
                value={draft.primaryKey.from}
                aria-label={t('mapping.primaryKeySource')}
                placeholder={t('mapping.chooseField')}
                options={fieldOptions}
                aria-invalid={showIssues && !draft.primaryKey.from}
                onChange={e =>
                  onDraft({
                    ...draft,
                    primaryKey: {...draft.primaryKey, from: e.target.value},
                  })
                }
              />
            )}
          </div>
          <div className="col-span-12 md:col-span-5">
            <TransformChainEditor
              label={t('mapping.primaryKey')}
              value={draft.primaryKey.transform}
              onChange={v =>
                onDraft({
                  ...draft,
                  primaryKey: {...draft.primaryKey, transform: v},
                })
              }
            />
          </div>
          {draft.primaryKey.ai && (
            <div className="col-span-12 flex flex-wrap items-center gap-1.5 text-[11px]">
              <AiBadge />
              {draft.primaryKey.ai.status === 'pending' ? (
                <>
                  <span className="text-muted">
                    {t('mapping.ai.suggestsPk')}
                  </span>
                  <code className="rounded bg-panel-2 px-1 font-mono text-violet">
                    {draft.primaryKey.ai.from}
                  </code>
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      className="h-6"
                      onClick={() => onDraft(acceptAiPrimaryKey(draft))}
                    >
                      <Check aria-hidden />
                      {t('mapping.ai.accept')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6"
                      onClick={() => onDraft(dismissAiPrimaryKey(draft))}
                    >
                      <X aria-hidden />
                      {t('mapping.ai.dismiss')}
                    </Button>
                  </span>
                </>
              ) : (
                <Badge tone="good">
                  <Check aria-hidden />
                  {t('mapping.ai.confirmed')}
                </Badge>
              )}
            </div>
          )}
        </div>

        <Table aria-label={t('mapping.tableLabel')}>
          <THead>
            <tr>
              <Th className="w-[34%]">{t('mapping.cols.source')}</Th>
              <Th className="w-[26%]">{t('mapping.cols.target')}</Th>
              <Th>{t('mapping.cols.transform')}</Th>
              {freeText && <Th className="w-8" />}
            </tr>
          </THead>
          <TBody>
            {draft.fields.length === 0 && (
              <Tr>
                <Td
                  colSpan={freeText ? 4 : 3}
                  className="py-6 text-center text-xs text-dim"
                >
                  {t('mapping.noFields')}
                </Td>
              </Tr>
            )}
            {draft.fields.map(r => {
              const samples = sampleValues(sampleRows, r.from, 3);
              const isPk = r.from === draft.primaryKey.from;
              return (
                <Tr
                  key={r.from}
                  className={cn(
                    'align-top',
                    r.ai?.status === 'pending' && 'bg-violet/[0.04]',
                  )}
                >
                  <Td className="align-top">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-medium text-text">
                        {r.from}
                      </span>
                      {isPk && (
                        <Badge tone="cyan">
                          <KeyRound aria-hidden />
                          {t('mapping.pkTag')}
                        </Badge>
                      )}
                    </div>
                    {samples.length > 0 && (
                      <p
                        className="mt-1 flex flex-wrap gap-1"
                        aria-label={t('mapping.samples', {field: r.from})}
                      >
                        {samples.map(s => (
                          <span
                            key={s}
                            className="max-w-40 truncate rounded bg-panel-2 px-1.5 text-[11px] text-muted"
                            title={s}
                          >
                            {s}
                          </span>
                        ))}
                      </p>
                    )}
                  </Td>
                  <Td className="align-top">
                    <NativeSelect
                      size="sm"
                      value={r.to}
                      placeholder={t('mapping.skip')}
                      options={propOptions}
                      aria-label={t('mapping.targetFor', {field: r.from})}
                      onChange={e => setRow(r.from, {to: e.target.value})}
                    />
                  </Td>
                  <Td className="align-top">
                    <div className="flex flex-col gap-1.5">
                      <TransformChainEditor
                        label={r.from}
                        value={r.transform}
                        disabled={!r.to}
                        onChange={v => setRow(r.from, {transform: v})}
                      />
                      <AiStrip
                        row={r}
                        propLabel={r.ai ? propLabel(r.ai.to) : ''}
                        onAccept={() => onDraft(acceptAi(draft, r.from))}
                        onDismiss={() => onDraft(dismissAi(draft, r.from))}
                      />
                    </div>
                  </Td>
                  {freeText && (
                    <Td className="align-top">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('mapping.removeField', {field: r.from})}
                        onClick={() =>
                          onDraft({
                            ...draft,
                            fields: draft.fields.filter(x => x.from !== r.from),
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </TBody>
        </Table>

        {freeText && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={e => {
              e.preventDefault();
              const f = newField.trim();
              if (!f || fields.includes(f)) return;
              onDraft({
                ...draft,
                fields: [...draft.fields, {from: f, to: '', transform: ''}],
              });
              setNewField('');
            }}
          >
            <Input
              inputSize="sm"
              className="max-w-60 font-mono"
              value={newField}
              onChange={e => setNewField(e.target.value)}
              aria-label={t('mapping.newField')}
              placeholder={t('mapping.newFieldPlaceholder')}
            />
            <Button size="sm" type="submit" variant="ghost">
              <Plus aria-hidden />
              {t('mapping.addField')}
            </Button>
          </form>
        )}

        {/* Links */}
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-text">
                <Link2 className="size-3.5 text-cyan" aria-hidden />
                {t('mapping.links.title')}
              </p>
              <p className="text-[11px] text-muted">
                {t('mapping.links.hint')}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={outgoing.length === 0}
              title={
                outgoing.length === 0 ? t('mapping.links.none') : undefined
              }
              onClick={() =>
                onDraft({
                  ...draft,
                  links: [
                    ...draft.links,
                    {
                      id: rowId('l'),
                      type: outgoing[0]?.apiName ?? '',
                      toKey: '',
                      split: '',
                      weightFrom: '',
                    },
                  ],
                })
              }
            >
              <Plus aria-hidden />
              {t('mapping.links.add')}
            </Button>
          </div>
          {draft.links.map((l, i) => (
            <div
              key={l.id}
              className="mb-2 grid grid-cols-12 items-center gap-2"
            >
              <NativeSelect
                size="sm"
                className="col-span-12 md:col-span-3"
                value={l.type}
                aria-label={t('mapping.links.type', {n: i + 1})}
                options={outgoing.map(o => ({
                  value: o.apiName,
                  label: `${o.displayName} → ${o.to}`,
                }))}
                onChange={e =>
                  onDraft({
                    ...draft,
                    links: draft.links.map(x =>
                      x.id === l.id ? {...x, type: e.target.value} : x,
                    ),
                  })
                }
              />
              {freeText ? (
                <Input
                  inputSize="sm"
                  className="col-span-6 md:col-span-3"
                  value={l.toKey}
                  aria-label={t('mapping.links.toKey', {n: i + 1})}
                  placeholder={t('mapping.links.toKeyPlaceholder')}
                  onChange={e =>
                    onDraft({
                      ...draft,
                      links: draft.links.map(x =>
                        x.id === l.id ? {...x, toKey: e.target.value} : x,
                      ),
                    })
                  }
                />
              ) : (
                <NativeSelect
                  size="sm"
                  className="col-span-6 md:col-span-3"
                  value={l.toKey}
                  placeholder={t('mapping.links.toKeyPlaceholder')}
                  aria-label={t('mapping.links.toKey', {n: i + 1})}
                  options={fieldOptions}
                  onChange={e =>
                    onDraft({
                      ...draft,
                      links: draft.links.map(x =>
                        x.id === l.id ? {...x, toKey: e.target.value} : x,
                      ),
                    })
                  }
                />
              )}
              <Input
                inputSize="sm"
                className="col-span-6 md:col-span-2 font-mono"
                maxLength={3}
                value={l.split}
                aria-label={t('mapping.links.split', {n: i + 1})}
                placeholder={t('mapping.links.splitPlaceholder')}
                onChange={e =>
                  onDraft({
                    ...draft,
                    links: draft.links.map(x =>
                      x.id === l.id ? {...x, split: e.target.value} : x,
                    ),
                  })
                }
              />
              <NativeSelect
                size="sm"
                className="col-span-10 md:col-span-3"
                value={l.weightFrom}
                placeholder={t('mapping.links.noWeight')}
                aria-label={t('mapping.links.weight', {n: i + 1})}
                options={fieldOptions}
                onChange={e =>
                  onDraft({
                    ...draft,
                    links: draft.links.map(x =>
                      x.id === l.id ? {...x, weightFrom: e.target.value} : x,
                    ),
                  })
                }
              />
              <Button
                size="icon-sm"
                variant="ghost"
                className="col-span-2 md:col-span-1"
                aria-label={t('mapping.links.remove', {n: i + 1})}
                onClick={() =>
                  onDraft({
                    ...draft,
                    links: draft.links.filter(x => x.id !== l.id),
                  })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <div className="mt-3 grid grid-cols-12 items-center gap-2">
            <label
              htmlFor="source-ts"
              className="col-span-12 text-xs text-muted md:col-span-4"
            >
              {t('mapping.sourceTs')}
            </label>
            <NativeSelect
              id="source-ts"
              size="sm"
              className="col-span-12 md:col-span-4"
              value={draft.sourceTsFrom}
              placeholder={t('mapping.sourceTsNone')}
              options={fieldOptions}
              onChange={e => onDraft({...draft, sourceTsFrom: e.target.value})}
            />
          </div>
        </div>

        {issues.length > 0 && (
          <ul
            className="mt-3 flex flex-col gap-1"
            aria-label={t('mapping.issues.title')}
          >
            {issues
              .filter(i => i.warning || showIssues)
              .map((i, idx) => (
                <li
                  key={`${i.key}-${idx}`}
                  role={i.warning ? undefined : 'alert'}
                  className={cn(
                    'flex items-start gap-1.5 text-xs',
                    i.warning ? 'text-warn' : 'text-crit',
                  )}
                >
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                  {t(i.key, i.params)}
                </li>
              ))}
          </ul>
        )}
      </Panel>

      <MappingPreview
        draft={draft}
        targetType={targetType}
        type={type}
        compiled={compiled}
        rows={sampleRows}
      />
    </div>
  );
}
