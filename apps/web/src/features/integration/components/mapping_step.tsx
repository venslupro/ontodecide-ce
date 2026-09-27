/**
 * @fileoverview Wizard step 3 (字段映射): source field, sample, target
 * property (from the ontology, incl. the primary key) or link type,
 * transform chain / separator and status (已确认 / 确定性匹配 / AI 建议 /
 * 待确认). 「AI 生成映射草稿」 (≤ 2 per day) shows the remaining quota and
 * an inline QuotaNotice on 429; every AI suggestion needs an explicit
 * confirmation (per row or all at once) before Next is enabled.
 */

import type {QuotaKey} from '@ontodecide/shared-kernel';
import {Check, Info, Sparkles, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {UiModel, UiObjectType} from '../../../entities/schema/model';
import {errorMessage} from '../../../shared/api/error_message';
import {isApiError} from '../../../shared/api/errors';
import {Badge, StatusBadge, type StatusLevel} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';
import {
  QuotaNotice,
  QuotaRemaining,
} from '../../situation/components/quota_notice';
import {
  confirmRow,
  dismissRow,
  fieldStatus,
  mappingProblems,
  outgoingLinks,
  parseTargetValue,
  setTarget,
  targetValue,
  type FieldMapping,
  type FieldStatus,
} from '../mapping';
import type {ParsedFile} from '../parse_client';
import {cellText} from './sample_table';
import {
  TransformChainEditor,
  TransformDatalist,
} from './transform_chain_editor';

const STATUS_LEVEL: Record<FieldStatus, StatusLevel> = {
  confirmed: 'good',
  deterministic: 'info',
  ai: 'info',
  pending: 'warn',
};

/** Outcome of the last AI draft request. */
export interface DraftInfo {
  rankedBy: 'ai' | 'rules';
  aiCount: number;
}

/** A failed draft request and the quota it concerns. */
export interface DraftError {
  error: unknown;
  quota: QuotaKey;
}

function StatusCell({m}: {m: FieldMapping}) {
  const {t} = useTranslation('imports');
  const s = fieldStatus(m);
  if (s === 'ai') {
    return (
      <Badge tone="violet">
        <Sparkles aria-hidden />
        {t('mapping.status.ai')}
      </Badge>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <StatusBadge level={STATUS_LEVEL[s]}>
        {t(`mapping.status.${s}`)}
      </StatusBadge>
      {s === 'deterministic' && m.matchedBy && (
        <span className="text-[10px] text-dim">
          {t(`mapping.matchedBy.${m.matchedBy}`)}
        </span>
      )}
    </span>
  );
}

function firstSample(file: ParsedFile, field: string): string {
  for (const r of file.sampleRows) {
    const s = cellText(r[field]);
    if (s.trim() !== '') return s;
  }
  return '';
}

/** Step 3: mapping table and AI draft. */
export function MappingStep({
  file,
  type,
  model,
  rows,
  onRows,
  onDraft,
  draftBusy,
  draftError,
  draftInfo,
  canDraft,
}: {
  file: ParsedFile;
  type: UiObjectType;
  model: UiModel;
  rows: FieldMapping[];
  onRows: (rows: FieldMapping[]) => void;
  onDraft: () => void;
  draftBusy: boolean;
  draftError: DraftError | null;
  draftInfo: DraftInfo | null;
  canDraft: boolean;
}) {
  const {t} = useTranslation('imports');
  const links = outgoingLinks(model, type.apiName);
  const options = [
    ...type.properties.map(p => ({
      value: `prop:${p.apiName}`,
      label:
        p.apiName === type.primaryKey
          ? t('mapping.pk', {name: p.apiName})
          : p.apiName,
    })),
    ...links.map(l => ({
      value: `link:${l.apiName}`,
      label: t('mapping.linkOption', {link: l.apiName, to: l.to}),
    })),
  ];
  const update = (i: number, m: FieldMapping) =>
    onRows(rows.map((r, j) => (j === i ? m : r)));
  const problems = mappingProblems(rows, type);
  const aiRows = rows.filter(r => fieldStatus(r) === 'ai').length;

  return (
    <div className="flex flex-col gap-3">
      <TransformDatalist />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          {t('mapping.title')}
          <Badge tone="blue" className="font-mono">
            {type.apiName}
          </Badge>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <QuotaRemaining quota="mappingDraftsToday" />
          {aiRows > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onRows(
                  rows.map(r => (fieldStatus(r) === 'ai' ? confirmRow(r) : r)),
                )
              }
            >
              <Check aria-hidden />
              {t('mapping.confirmAll', {count: aiRows})}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={onDraft}
            loading={draftBusy}
            disabled={!canDraft || draftBusy}
          >
            <Sparkles aria-hidden />
            {t('mapping.aiDraft')}
          </Button>
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('mapping.aiNote')}
      </p>
      {!canDraft && (
        <p className="text-xs text-warn">{t('mapping.noRowsLeft')}</p>
      )}
      {draftError &&
        (isApiError(draftError.error, 'QUOTA_EXCEEDED') ? (
          <QuotaNotice error={draftError.error} quota={draftError.quota} />
        ) : (
          <p role="alert" className="text-xs text-crit">
            {errorMessage(draftError.error, t)}
          </p>
        ))}
      {draftInfo && (
        <p role="status" className="text-xs text-muted">
          {draftInfo.rankedBy === 'rules'
            ? t('mapping.aiRules')
            : t('mapping.aiApplied', {count: draftInfo.aiCount})}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-line">
        <Table aria-label={t('mapping.title')}>
          <THead>
            <Tr>
              <Th>{t('mapping.col.source')}</Th>
              <Th>{t('mapping.col.sample')}</Th>
              <Th>{t('mapping.col.target')}</Th>
              <Th>{t('mapping.col.transform')}</Th>
              <Th>{t('mapping.col.status')}</Th>
              <Th>{t('mapping.col.actions')}</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((m, i) => {
              const status = fieldStatus(m);
              return (
                <Tr key={m.source} data-testid={`mapping-row-${m.source}`}>
                  <Td className="font-mono text-xs">{m.source}</Td>
                  <Td
                    className="max-w-40 truncate text-xs text-muted"
                    title={firstSample(file, m.source)}
                  >
                    {firstSample(file, m.source)}
                  </Td>
                  <Td className="min-w-44">
                    <NativeSelect
                      size="sm"
                      aria-label={t('mapping.targetAria', {field: m.source})}
                      value={targetValue(m.target)}
                      placeholder={t('mapping.targetNone')}
                      options={options}
                      onChange={e =>
                        update(
                          i,
                          setTarget(
                            m,
                            parseTargetValue(e.target.value, model),
                            type,
                          ),
                        )
                      }
                    />
                  </Td>
                  <Td>
                    {m.target?.kind === 'prop' ? (
                      <TransformChainEditor
                        value={m.transform}
                        label={t('mapping.transformAria', {field: m.source})}
                        onChange={v => update(i, {...m, transform: v})}
                      />
                    ) : m.target?.kind === 'link' ? (
                      <label className="flex items-center gap-1.5 text-xs text-muted">
                        {t('mapping.split')}
                        <Input
                          inputSize="sm"
                          className="w-14 font-mono"
                          maxLength={4}
                          value={m.split}
                          aria-label={t('mapping.splitAria', {field: m.source})}
                          onChange={e =>
                            update(i, {...m, split: e.target.value})
                          }
                        />
                      </label>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusCell m={m} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    {(status === 'ai' ||
                      (status === 'pending' && m.target)) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('mapping.confirmAria', {field: m.source})}
                        onClick={() => update(i, confirmRow(m))}
                      >
                        <Check aria-hidden />
                        {t('mapping.confirm')}
                      </Button>
                    )}
                    {status === 'ai' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t('mapping.dismissAria', {field: m.source})}
                        onClick={() => update(i, dismissRow(m))}
                      >
                        <X aria-hidden />
                        {t('mapping.dismiss')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>
      {problems.length > 0 && (
        <ul
          className="flex flex-col gap-1 text-xs text-warn"
          aria-live="polite"
        >
          {problems.map(p => (
            <li
              key={`${p.code}:${'prop' in p ? p.prop : 'source' in p ? p.source : ''}`}
            >
              {t(`mapping.problems.${p.code}`, p)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
