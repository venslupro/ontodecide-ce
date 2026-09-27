/**
 * @fileoverview Wizard step 2 (上传文件): pick or drop a file, which is
 * parsed in the browser (Web Worker) — the raw file is never uploaded —
 * with the 5 MB limit checked before reading, then the sample table.
 */

import {CE_LIMITS} from '@ontodecide/shared-kernel';
import {FileUp, ShieldCheck} from 'lucide-react';
import {useRef, useState, type DragEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {cn} from '../../../shared/lib/cn';
import {Button} from '../../../shared/ui/button';
import {Spinner} from '../../../shared/ui/skeleton';
import {PARSE_LIMITS, SAMPLE_ROWS} from '../../../workers/parse_core';
import {parseFile, ParseError, type ParsedFile} from '../parse_client';
import {SampleTable} from './sample_table';

const MB = Math.round(CE_LIMITS.maxFileBytes / 1024 / 1024);

/** Step 2: file picker, browser parse and sample. */
export function UploadStep({
  parsed,
  onParsed,
}: {
  parsed: ParsedFile | null;
  onParsed: (f: ParsedFile) => void;
}) {
  const {t} = useTranslation('imports');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ParseError | null>(null);
  const [over, setOver] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onParsed(await parseFile(file));
    } catch (e) {
      setError(
        e instanceof ParseError ? e : new ParseError('PARSE_FAILED', String(e)),
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void handle(e.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={e => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center',
          over ? 'border-cyan bg-cyan/5' : 'border-line-2',
        )}
      >
        <FileUp className="size-6 text-cyan" aria-hidden />
        <p className="text-sm text-text">
          {t('upload.drop')}{' '}
          <Button
            variant="link"
            size="sm"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            {t('upload.pick')}
          </Button>
        </p>
        <p className="text-xs text-dim">{t('upload.limit', {mb: MB})}</p>
        <input
          ref={input}
          type="file"
          accept=".csv,.xlsx,.json,text/csv,application/json"
          aria-label={t('upload.inputLabel')}
          className="sr-only"
          onChange={e => void handle(e.target.files?.[0])}
        />
      </div>
      <p className="flex items-center gap-2 text-xs text-good">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        {t('upload.notice')}
      </p>
      {busy && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Spinner />
          {t('upload.parsing')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-crit">
          {t(`parse.errors.${error.code}`, {mb: MB})}
        </p>
      )}
      {parsed && !busy && (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm text-text">
            <span className="font-mono">{parsed.name}</span> ·{' '}
            {t('upload.parsed', {
              rows: parsed.rows.length,
              cols: parsed.fields.length,
            })}
          </p>
          {parsed.truncated && (
            <p className="text-xs text-warn">
              {t('upload.truncated', {max: PARSE_LIMITS.maxRows})}
            </p>
          )}
          <SampleTable
            fields={parsed.fields}
            rows={parsed.sampleRows}
            caption={t('upload.sample', {count: SAMPLE_ROWS})}
          />
        </div>
      )}
    </div>
  );
}
