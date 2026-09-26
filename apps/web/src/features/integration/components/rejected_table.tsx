/**
 * @fileoverview Editable table of rejected records: payload fields as
 * inputs, error code / detail per row, row selection, "修正并重放" (replay
 * the selected rows with their corrected payloads) and "全部重放".
 */

import type {RawRecordDto} from '@ontodecide/integration/contract';
import {RotateCcw, Wrench} from 'lucide-react';
import {useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {Badge} from '../../../shared/ui/badge';
import {Button} from '../../../shared/ui/button';
import {Checkbox, Input} from '../../../shared/ui/input';
import {Table, TBody, Td, Th, THead, Tr} from '../../../shared/ui/table';

/** A corrected payload sent to `POST /jobs/:id/replay`. */
export interface ReplayFix {
  id: string;
  payload: Record<string, unknown>;
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** Converts an edited text back to the original value's type when possible. */
export function coerceEdit(original: unknown, text: string): unknown {
  if (typeof original === 'number') {
    const n = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(n) ? n : text;
  }
  if (typeof original === 'boolean') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    return text;
  }
  if (original !== null && typeof original === 'object') {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/** Applies text edits to a payload. */
export function applyEdits(
  payload: Record<string, unknown>,
  edits: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!edits) return {...payload};
  const out: Record<string, unknown> = {...payload};
  for (const [k, text] of Object.entries(edits))
    out[k] = coerceEdit(payload[k], text);
  return out;
}

/** Editable rejected-records table. */
export function RejectedTable({
  records,
  onReplay,
  replaying,
  canReplay,
}: {
  records: RawRecordDto[];
  onReplay: (fixes: ReplayFix[] | undefined) => Promise<unknown>;
  replaying: boolean;
  canReplay: boolean;
}) {
  const {t} = useTranslation('sources');
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fields = useMemo(() => {
    const seen = new Set<string>();
    for (const r of records)
      for (const k of Object.keys(r.payload ?? {})) seen.add(k);
    return [...seen];
  }, [records]);
  const editedCount = Object.keys(edits).filter(id =>
    records.some(r => r.id === id),
  ).length;
  const allSelected =
    records.length > 0 && records.every(r => selected.has(r.id));

  const setCell = (id: string, field: string, value: string) =>
    setEdits(prev => {
      const next = {...prev, [id]: {...prev[id], [field]: value}};
      return next;
    });
  const toggle = (id: string, on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const replaySelected = async () => {
    const fixes = records
      .filter(r => selected.has(r.id))
      .map(r => ({id: r.id, payload: applyEdits(r.payload, edits[r.id])}));
    await onReplay(fixes);
    setSelected(new Set());
    setEdits({});
  };
  const replayAll = async () => {
    const fixes =
      editedCount > 0
        ? records.map(r => ({
            id: r.id,
            payload: applyEdits(r.payload, edits[r.id]),
          }))
        : undefined;
    await onReplay(fixes);
    setSelected(new Set());
    setEdits({});
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          {t('job.rejected.selection', {
            selected: selected.size,
            edited: editedCount,
          })}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canReplay || selected.size === 0}
            loading={replaying}
            onClick={() => void replaySelected().catch(() => {})}
          >
            <Wrench aria-hidden />
            {t('job.rejected.fixReplay')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canReplay || records.length === 0 || replaying}
            onClick={() => void replayAll().catch(() => {})}
          >
            <RotateCcw aria-hidden />
            {t('job.rejected.replayAll')}
          </Button>
        </div>
      </div>
      <div className="max-h-[480px] overflow-auto rounded-lg border border-line">
        <Table aria-label={t('job.rejected.title')}>
          <THead>
            <tr>
              <Th className="w-8">
                <Checkbox
                  checked={allSelected}
                  aria-label={t('job.rejected.selectAll')}
                  onCheckedChange={c =>
                    setSelected(
                      c === true ? new Set(records.map(r => r.id)) : new Set(),
                    )
                  }
                />
              </Th>
              <Th className="w-14 text-right">{t('job.rejected.row')}</Th>
              {fields.map(f => (
                <Th key={f} className="font-mono">
                  {f}
                </Th>
              ))}
              <Th>{t('job.rejected.error')}</Th>
            </tr>
          </THead>
          <TBody>
            {records.map(r => {
              const rowEdits = edits[r.id];
              return (
                <Tr
                  key={r.id}
                  className={cn('align-top', selected.has(r.id) && 'bg-cyan/5')}
                >
                  <Td>
                    <Checkbox
                      checked={selected.has(r.id)}
                      aria-label={t('job.rejected.selectRow', {row: r.rowNo})}
                      onCheckedChange={c => toggle(r.id, c === true)}
                    />
                  </Td>
                  <Td className="num text-right text-xs text-dim">{r.rowNo}</Td>
                  {fields.map(f => {
                    const original = r.payload?.[f];
                    const value = rowEdits?.[f] ?? toText(original);
                    const edited =
                      rowEdits?.[f] !== undefined &&
                      rowEdits[f] !== toText(original);
                    const suspect =
                      !!r.errorDetail &&
                      new RegExp(
                        `\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
                      ).test(r.errorDetail);
                    return (
                      <Td key={f} className="min-w-32">
                        <Input
                          inputSize="sm"
                          value={value}
                          aria-label={t('job.rejected.cell', {
                            row: r.rowNo,
                            field: f,
                          })}
                          aria-invalid={suspect && !edited}
                          className={cn(
                            'font-mono',
                            edited && 'border-cyan/70 bg-cyan/5',
                          )}
                          onChange={e => {
                            setCell(r.id, f, e.target.value);
                            if (!selected.has(r.id)) toggle(r.id, true);
                          }}
                        />
                      </Td>
                    );
                  })}
                  <Td className="min-w-48">
                    <Badge tone="crit" className="font-mono">
                      {r.errorCode}
                    </Badge>
                    {r.errorDetail && (
                      <p className="mt-1 text-xs break-words text-muted">
                        {r.errorDetail}
                      </p>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
