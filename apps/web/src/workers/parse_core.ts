/**
 * @fileoverview Pure, environment-agnostic file parsing for the import
 * wizard (前端详细设计 算法描述 文件导入). Runs inside the parse Web Worker
 * and on the main thread as a fallback (jsdom). The raw file never leaves
 * the browser: only the parsed rows are handed to the wizard.
 *
 * - Size ≤ 5 MB (`CE_LIMITS.maxFileBytes`), checked before reading.
 * - CSV via PapaParse (header row, BOM stripped, empty rows skipped).
 * - XLSX via SheetJS (dynamically imported), first sheet, cell values only:
 *   no formulas evaluated, no HTML, no styles, no VBA macros.
 * - JSON: an array of objects, or `{items|data|records|rows: [...]}`.
 *
 * Parsing stops at {@link PARSE_LIMITS}.maxRows rows (a memory safety bound
 * above the 2,000 import rows per day); the upload plan marks rows beyond
 * the user's remaining quota as over-limit.
 */

import {CE_LIMITS} from '@ontodecide/shared-kernel';
import Papa from 'papaparse';

/** Supported file formats. */
export type FileFormat = 'csv' | 'xlsx' | 'json';

/** Every supported format, in display order. */
export const FILE_FORMATS: readonly FileFormat[] = ['csv', 'xlsx', 'json'];

/** A parsed source row (column → cell value). */
export type SourceRow = Record<string, unknown>;

/** Rows kept as a sample for the mapping step and the AI draft. */
export const SAMPLE_ROWS = 20;

/** Parser limits. */
export interface ParseLimits {
  /** Maximum file size in bytes. */
  maxBytes: number;
  /** Rows kept in memory; further rows are dropped (`truncated`). */
  maxRows: number;
}

/** Default limits. */
export const PARSE_LIMITS: ParseLimits = {
  maxBytes: CE_LIMITS.maxFileBytes,
  maxRows: 10_000,
};

/** Parse error codes (localized by the UI as `imports:parse.errors.<code>`). */
export type ParseErrorCode =
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'EMPTY_FILE'
  | 'INVALID_JSON'
  | 'NO_COLUMNS'
  | 'PARSE_FAILED';

/** A parse failure with a localizable code. */
export class ParseError extends Error {
  constructor(
    readonly code: ParseErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ParseError';
  }
}

/** Parsed table. */
export interface ParsedTable {
  format: FileFormat;
  /** Column names in file order. */
  fields: string[];
  /** Every row kept (≤ `maxRows`). */
  rows: SourceRow[];
  /** First {@link SAMPLE_ROWS} rows. */
  sampleRows: SourceRow[];
  /** True when rows beyond `maxRows` were dropped. */
  truncated: boolean;
}

/** Input of {@link parseFileData}. */
export interface ParseInput {
  name: string;
  size: number;
  type?: string;
  /** File content: a Blob, its bytes or its text. */
  data: Blob | ArrayBuffer | Uint8Array | string;
}

/** Message sent to the parse worker. */
export interface ParseRequest {
  name: string;
  size: number;
  type: string;
  data: Blob;
  limits?: Partial<ParseLimits>;
}

/** Message posted back by the parse worker. */
export type ParseResponse =
  | {ok: true; table: ParsedTable}
  | {ok: false; code: ParseErrorCode; detail?: string};

/** Detects the format from the file name (or MIME type). */
export function detectFormat(name: string, mime = ''): FileFormat | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv' || mime === 'text/csv') return 'csv';
  if (ext === 'xlsx' || mime.includes('spreadsheetml')) return 'xlsx';
  if (ext === 'json' || mime === 'application/json') return 'json';
  return null;
}

/** Cheap checks before reading the file: format, size, emptiness. */
export function precheckFile(
  file: {name: string; size: number; type?: string},
  limits: Partial<ParseLimits> = {},
): ParseError | null {
  const max = limits.maxBytes ?? PARSE_LIMITS.maxBytes;
  if (!detectFormat(file.name, file.type ?? '')) {
    return new ParseError('UNSUPPORTED_FORMAT', file.name);
  }
  if (file.size > max) return new ParseError('FILE_TOO_LARGE', String(max));
  if (file.size === 0) return new ParseError('EMPTY_FILE');
  return null;
}

function cleanHeader(h: unknown): string {
  return String(h ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
}

function isBlankCell(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === '';
}

function isBlankRow(row: SourceRow): boolean {
  return Object.values(row).every(isBlankCell);
}

/** Ordered union of the keys of the rows. */
export function unionKeys(rows: readonly SourceRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

/** Makes header names unique (`a`, `a_2`, …) and drops empty ones. */
export function uniqueHeaders(raw: readonly unknown[]): (string | null)[] {
  const used = new Set<string>();
  return raw.map(h => {
    const base = cleanHeader(h);
    if (!base) return null;
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    return name;
  });
}

function finish(
  format: FileFormat,
  fields: string[],
  rows: SourceRow[],
  truncated: boolean,
): ParsedTable {
  if (fields.length === 0) throw new ParseError('NO_COLUMNS');
  if (rows.length === 0) throw new ParseError('EMPTY_FILE');
  return {
    format,
    fields,
    rows,
    sampleRows: rows.slice(0, SAMPLE_ROWS),
    truncated,
  };
}

/** Parses CSV text (header row; BOM stripped; empty rows skipped). */
export function parseCsvText(
  text: string,
  limits: Partial<ParseLimits> = {},
): ParsedTable {
  const maxRows = limits.maxRows ?? PARSE_LIMITS.maxRows;
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    header: false,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  const fatal = res.errors.find(
    e => e.type === 'Quotes' && res.data.length === 0,
  );
  if (fatal) throw new ParseError('PARSE_FAILED', fatal.message);
  const [head, ...body] = res.data;
  if (!head) throw new ParseError('EMPTY_FILE');
  const headers = uniqueHeaders(head);
  const fields = headers.filter((h): h is string => h !== null);
  const rows: SourceRow[] = [];
  let truncated = false;
  for (const cells of body) {
    const row: SourceRow = {};
    headers.forEach((h, i) => {
      if (h !== null) row[h] = cells[i] ?? '';
    });
    if (isBlankRow(row)) continue;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return finish('csv', fields, rows, truncated);
}

/** Extracts the records array of parsed JSON, or null when not tabular. */
export function jsonRecords(value: unknown): SourceRow[] | null {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    arr = ['items', 'data', 'records', 'rows']
      .map(k => obj[k])
      .find(Array.isArray);
  }
  if (!Array.isArray(arr)) return null;
  const ok = arr.every(
    r => r !== null && typeof r === 'object' && !Array.isArray(r),
  );
  return ok ? (arr as SourceRow[]) : null;
}

/** Parses JSON text (array of objects or a wrapper object). */
export function parseJsonText(
  text: string,
  limits: Partial<ParseLimits> = {},
): ParsedTable {
  const maxRows = limits.maxRows ?? PARSE_LIMITS.maxRows;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new ParseError(
      'INVALID_JSON',
      e instanceof Error ? e.message : String(e),
    );
  }
  const all = jsonRecords(parsed);
  if (!all) throw new ParseError('INVALID_JSON');
  const kept = all.filter(r => !isBlankRow(r));
  const rows = kept.slice(0, maxRows);
  return finish('json', unionKeys(rows), rows, kept.length > rows.length);
}

function cellValue(v: unknown): unknown {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  }
  return v ?? '';
}

/**
 * Parses the first sheet of an XLSX workbook. Only stored cell values are
 * read: formulas are not evaluated, HTML / styles / VBA are ignored.
 */
export async function parseXlsxBuffer(
  buf: ArrayBuffer | Uint8Array,
  limits: Partial<ParseLimits> = {},
): Promise<ParsedTable> {
  const maxRows = limits.maxRows ?? PARSE_LIMITS.maxRows;
  const XLSX = await import('xlsx');
  let wb: import('xlsx').WorkBook;
  try {
    wb = XLSX.read(buf instanceof Uint8Array ? buf : new Uint8Array(buf), {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      cellDates: true,
    });
  } catch (e) {
    throw new ParseError(
      'PARSE_FAILED',
      e instanceof Error ? e.message : String(e),
    );
  }
  const first = wb.SheetNames[0];
  const sheet = first ? wb.Sheets[first] : undefined;
  if (!sheet || !sheet['!ref']) throw new ParseError('EMPTY_FILE');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
  const headIndex = matrix.findIndex(r => !r.every(isBlankCell));
  if (headIndex < 0) throw new ParseError('EMPTY_FILE');
  const headers = uniqueHeaders(matrix[headIndex]);
  const fields = headers.filter((h): h is string => h !== null);
  const rows: SourceRow[] = [];
  let truncated = false;
  for (const cells of matrix.slice(headIndex + 1)) {
    const row: SourceRow = {};
    headers.forEach((h, i) => {
      if (h !== null) row[h] = cellValue(cells[i]);
    });
    if (isBlankRow(row)) continue;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return finish('xlsx', fields, rows, truncated);
}

function isBlob(v: unknown): v is Blob {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

/** Reads a Blob as bytes (FileReader fallback for runtimes such as jsdom). */
export function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then(b => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsArrayBuffer(blob);
  });
}

async function asBytes(data: ParseInput['data']): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (isBlob(data)) return blobBytes(data);
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

async function asText(data: ParseInput['data']): Promise<string> {
  if (typeof data === 'string') return data;
  return new TextDecoder('utf-8').decode(await asBytes(data));
}

/**
 * Parses one file. The size is checked before the content is read.
 * Throws {@link ParseError}.
 */
export async function parseFileData(
  input: ParseInput,
  limits: Partial<ParseLimits> = {},
): Promise<ParsedTable> {
  const pre = precheckFile(input, limits);
  if (pre) throw pre;
  const format = detectFormat(input.name, input.type ?? '')!;
  try {
    if (format === 'xlsx') {
      return await parseXlsxBuffer(await asBytes(input.data), limits);
    }
    const text = await asText(input.data);
    return format === 'csv'
      ? parseCsvText(text, limits)
      : parseJsonText(text, limits);
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(
      'PARSE_FAILED',
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** Handles one worker request (shared by the worker and its tests). */
export async function handleParseRequest(
  req: ParseRequest,
): Promise<ParseResponse> {
  try {
    const table = await parseFileData(
      {name: req.name, size: req.size, type: req.type, data: req.data},
      req.limits,
    );
    return {ok: true, table};
  } catch (e) {
    const err =
      e instanceof ParseError
        ? e
        : new ParseError('PARSE_FAILED', e instanceof Error ? e.message : '');
    return {ok: false, code: err.code, detail: err.detail};
  }
}
