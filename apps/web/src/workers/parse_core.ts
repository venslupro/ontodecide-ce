/**
 * @fileoverview Pure, environment-agnostic file parsing used by the parse
 * Web Worker (and on the main thread as a fallback when `Worker` is not
 * available, e.g. in jsdom). CSV is streamed with PapaParse (`header:
 * true`), XLSX is read with SheetJS (lazily imported) and JSON must be an
 * array of objects. Parsed rows are emitted as `batch` messages of ≤ 500
 * rows; the boundary values (20 MB / 10,000 rows) are enforced here.
 */

import {INGEST_LIMITS} from '@ontodecide/integration/contract';
import Papa from 'papaparse';

/** Supported file formats. */
export type FileFormat = 'csv' | 'xlsx' | 'json';

/** A parsed source record (CSV/XLSX values are strings). */
export type SourceRow = Record<string, unknown>;

/** Rows per emitted batch (= rows per upload batch). */
export const PARSE_BATCH_ROWS = INGEST_LIMITS.batchRecordsMax;

/** Rows included in the `meta` message as a sample. */
export const SAMPLE_ROWS = 20;

/** Parse error codes (localized by the UI). */
export type ParseErrorCode =
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'UNSUPPORTED_FORMAT'
  | 'EMPTY_FILE'
  | 'INVALID_JSON'
  | 'PARSE_FAILED';

/** Messages posted by the parser (worker → main thread). */
export type ParseMessage =
  | {type: 'meta'; fields: string[]; sampleRows: SourceRow[]}
  | {type: 'batch'; seq: number; rows: SourceRow[]}
  | {type: 'done'; rows: number; ms: number}
  | {type: 'error'; code: ParseErrorCode; detail?: string};

/** Request sent to the parser (main thread → worker). */
export interface ParseRequest {
  name: string;
  size: number;
  /** The file itself, or its text (tests / pre-read input). */
  data: Blob | string;
  /** Overrides for the limits (tests). */
  limits?: Partial<ParseLimits>;
}

/** Parser limits. */
export interface ParseLimits {
  bytesMax: number;
  rowsMax: number;
  batchRows: number;
}

/** Default limits from the ingestion boundary values. */
export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  bytesMax: INGEST_LIMITS.fileBytesMax,
  rowsMax: INGEST_LIMITS.fileRowsMax,
  batchRows: PARSE_BATCH_ROWS,
};

/** Detects the format from the file name (or MIME type). */
export function detectFormat(name: string, mime = ''): FileFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv' || ext === 'txt' || mime === 'text/csv') return 'csv';
  if (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheetml'))
    return 'xlsx';
  if (ext === 'json' || mime === 'application/json') return 'json';
  return null;
}

/**
 * Collects rows, emitting `meta` once (after the sample is complete or at
 * the end) and `batch` messages every `batchRows` rows. Returns false from
 * {@link RowSink.push} when the row limit is exceeded.
 */
export class RowSink {
  private fields: string[] = [];
  private sample: SourceRow[] = [];
  private pending: SourceRow[] = [];
  private metaSent = false;
  private seq = 0;
  /** Total rows accepted. */
  count = 0;
  /** Set when the row limit was exceeded. */
  overflow = false;

  constructor(
    private readonly post: (m: ParseMessage) => void,
    private readonly limits: ParseLimits,
  ) {}

  /** Sets the header fields (once). */
  setFields(fields: string[]): void {
    if (this.fields.length === 0) this.fields = fields;
  }

  /** Adds one row; false when the row limit is exceeded. */
  push(row: SourceRow): boolean {
    if (this.count >= this.limits.rowsMax) {
      this.overflow = true;
      return false;
    }
    this.count++;
    if (this.sample.length < SAMPLE_ROWS) this.sample.push(row);
    if (!this.metaSent && this.sample.length >= SAMPLE_ROWS) this.sendMeta();
    this.pending.push(row);
    if (this.pending.length >= this.limits.batchRows) this.flush();
    return true;
  }

  private sendMeta(): void {
    if (this.metaSent) return;
    this.metaSent = true;
    if (this.fields.length === 0) this.fields = unionKeys(this.sample);
    this.post({type: 'meta', fields: this.fields, sampleRows: this.sample});
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    this.sendMeta();
    this.post({type: 'batch', seq: this.seq++, rows: this.pending});
    this.pending = [];
  }

  /** Emits the remaining rows and the `done` message. */
  finish(startedAt: number, now: number): void {
    this.sendMeta();
    this.flush();
    this.post({
      type: 'done',
      rows: this.count,
      ms: Math.max(0, Math.round(now - startedAt)),
    });
  }
}

/** Ordered union of the keys of the rows. */
export function unionKeys(rows: readonly SourceRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

function cleanHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim();
}

/** Streams CSV text or a CSV Blob into the sink. Resolves when finished. */
export function parseCsv(
  data: Blob | string,
  sink: RowSink,
): Promise<{error?: string}> {
  return new Promise(resolve => {
    let failure: string | undefined;
    const step = (
      res: Papa.ParseStepResult<Record<string, string>>,
      parser: Papa.Parser,
    ) => {
      if (res.meta.fields) sink.setFields(res.meta.fields);
      const row = res.data;
      // Skip rows without any value (PapaParse keeps whitespace-only rows).
      if (
        !row ||
        Object.values(row).every(
          v => v === undefined || v === null || String(v).trim() === '',
        )
      )
        return;
      // Drop PapaParse's overflow bucket for rows with extra columns.
      const {__parsed_extra: _extra, ...clean} = row as Record<
        string,
        string
      > & {__parsed_extra?: unknown};
      if (!sink.push(clean)) parser.abort();
    };
    const common = {
      header: true as const,
      skipEmptyLines: 'greedy' as const,
      transformHeader: cleanHeader,
      step,
    };
    if (typeof data === 'string') {
      Papa.parse<Record<string, string>>(data.replace(/^\uFEFF/, ''), {
        ...common,
        complete: () => resolve({error: failure}),
      });
    } else {
      Papa.parse<Record<string, string>>(data as File, {
        ...common,
        complete: () => resolve({error: failure}),
        error: (e: Error) => {
          failure = e.message;
          resolve({error: failure});
        },
      });
    }
  });
}

/** Extracts the records array from parsed JSON (array, or {items|data|records}). */
export function jsonRecords(value: unknown): SourceRow[] | null {
  const arr = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (['items', 'data', 'records', 'rows'] as const)
          .map(k => (value as Record<string, unknown>)[k])
          .find(Array.isArray)
      : undefined;
  if (!Array.isArray(arr)) return null;
  if (!arr.every(r => r !== null && typeof r === 'object' && !Array.isArray(r)))
    return null;
  return arr as SourceRow[];
}

/** Reads a Blob as UTF-8 text (FileReader fallback for older runtimes / jsdom). */
export function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsText(blob);
  });
}

/** Reads a Blob as an ArrayBuffer (FileReader fallback). */
export function blobBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsArrayBuffer(blob);
  });
}

async function readText(data: Blob | string): Promise<string> {
  return typeof data === 'string' ? data : blobText(data);
}

/**
 * Parses a file and posts `meta` → `batch`* → `done`, or `error` (possibly after some batches, which the receiver must discard).
 * `now` is injectable for deterministic tests.
 */
export async function parseFile(
  req: ParseRequest,
  post: (m: ParseMessage) => void,
  now: () => number = () => (globalThis.performance ?? Date).now(),
): Promise<void> {
  const limits = {...DEFAULT_PARSE_LIMITS, ...req.limits};
  const startedAt = now();
  const mime = typeof req.data === 'string' ? '' : req.data.type;
  const format = detectFormat(req.name, mime);
  if (!format) {
    post({type: 'error', code: 'UNSUPPORTED_FORMAT', detail: req.name});
    return;
  }
  if (req.size > limits.bytesMax) {
    post({type: 'error', code: 'FILE_TOO_LARGE', detail: String(req.size)});
    return;
  }
  if (req.size === 0) {
    post({type: 'error', code: 'EMPTY_FILE'});
    return;
  }
  // Messages stream as rows are parsed; an `error` after some batches
  // (row limit exceeded mid-file) tells the receiver to discard them.
  const sink = new RowSink(post, limits);
  try {
    if (format === 'csv') {
      const {error} = await parseCsv(req.data, sink);
      if (error) {
        post({type: 'error', code: 'PARSE_FAILED', detail: error});
        return;
      }
    } else if (format === 'json') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readText(req.data));
      } catch (e) {
        post({
          type: 'error',
          code: 'INVALID_JSON',
          detail: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      const rows = jsonRecords(parsed);
      if (!rows) {
        post({type: 'error', code: 'INVALID_JSON'});
        return;
      }
      if (rows.length > limits.rowsMax) {
        post({
          type: 'error',
          code: 'TOO_MANY_ROWS',
          detail: String(rows.length),
        });
        return;
      }
      sink.setFields(unionKeys(rows.slice(0, 1000)));
      for (const r of rows) sink.push(r);
    } else {
      const XLSX = await import('xlsx');
      const buf =
        typeof req.data === 'string'
          ? new TextEncoder().encode(req.data)
          : await blobBuffer(req.data);
      const wb = XLSX.read(buf, {type: 'array', cellDates: true});
      const sheet = wb.SheetNames[0] ? wb.Sheets[wb.SheetNames[0]] : undefined;
      if (!sheet || !sheet['!ref']) {
        post({type: 'error', code: 'EMPTY_FILE'});
        return;
      }
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const dataRows = range.e.r - range.s.r; // minus the header row
      if (dataRows > limits.rowsMax) {
        post({type: 'error', code: 'TOO_MANY_ROWS', detail: String(dataRows)});
        return;
      }
      const header = (
        XLSX.utils.sheet_to_json<unknown[]>(sheet, {header: 1, range: 0})[0] ??
        []
      )
        .map(h => cleanHeader(String(h ?? '')))
        .filter(h => h !== '');
      sink.setFields(header);
      const rows = XLSX.utils.sheet_to_json<SourceRow>(sheet, {
        defval: '',
        raw: false,
      });
      for (const r of rows) {
        if (Object.values(r).every(v => String(v).trim() === '')) continue;
        if (!sink.push(r)) break;
      }
    }
  } catch (e) {
    post({
      type: 'error',
      code: 'PARSE_FAILED',
      detail: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  if (sink.overflow) {
    post({
      type: 'error',
      code: 'TOO_MANY_ROWS',
      detail: String(limits.rowsMax),
    });
    return;
  }
  if (sink.count === 0) {
    post({type: 'error', code: 'EMPTY_FILE'});
    return;
  }
  sink.finish(startedAt, now());
}
