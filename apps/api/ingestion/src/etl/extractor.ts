/**
 * Extractor: turn raw file bytes (CSV / JSON / Parquet) into a uniform list
 * of record objects.
 *
 * Parquet is parsed with `hyparquet` — a pure-JS implementation that works in
 * Cloudflare Workers (no Node.js built-ins required). CSV is parsed with a
 * minimal hand-rolled parser that handles quoted fields and escaped quotes;
 * for production-grade parsing, swap in `papaparse` (the worker bundle can
 * include it under `nodejs_compat`).
 */
import { ERROR_CODES, throwError } from '@ontodecide/shared';
import { parquetReadObjects } from 'hyparquet';

/** A record extracted from the source file. */
export type ExtractedRecord = Record<string, unknown>;

/** Extract records from a byte buffer of the given format. */
export async function extract(
  bytes: Uint8Array,
  format: 'csv' | 'json' | 'parquet' | 'webhook',
): Promise<ExtractedRecord[]> {
  switch (format) {
    case 'json':
      return extractJson(bytes);
    case 'csv':
      return extractCsv(bytes);
    case 'webhook':
      // Webhook payloads arrive via the sync path and are already JSON; this
      // branch is only hit when a webhook is enqueued for retry.
      return extractJson(bytes);
    case 'parquet':
      return extractParquet(bytes);
    default:
      throwError(ERROR_CODES.INGEST_FORMAT_UNSUPPORTED, `Unknown format: ${format as string}`);
  }
  return [];
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function extractJson(bytes: Uint8Array): ExtractedRecord[] {
  const text = decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throwError(
      ERROR_CODES.INGEST_MAPPING_FAILED,
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((row) => row && typeof row === 'object') as ExtractedRecord[];
  }
  if (parsed && typeof parsed === 'object' && 'records' in parsed) {
    const records = (parsed as { records: unknown[] }).records;
    if (Array.isArray(records)) {
      return records.filter((row) => row && typeof row === 'object') as ExtractedRecord[];
    }
  }
  throwError(ERROR_CODES.INGEST_MAPPING_FAILED, 'JSON payload is not an array of records.');
  return [];
}

function extractCsv(bytes: Uint8Array): ExtractedRecord[] {
  const text = decode(bytes);
  const lines = splitCsvLines(text);
  if (lines.length < 2) {
    throwError(ERROR_CODES.INGEST_MAPPING_FAILED, 'CSV needs at least a header and one row.');
  }
  const headers = parseCsvRow(lines[0]);
  const records: ExtractedRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvRow(lines[i]);
    if (values.length === 0) continue;
    const record: ExtractedRecord = {};
    headers.forEach((header, idx) => {
      record[header] = values[idx] ?? '';
    });
    records.push(record);
  }
  return records;
}

/** Split CSV into logical lines, respecting quoted newlines. */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      // Skip the \n in \r\n.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    current += ch;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Parse a single CSV row, supporting quoted commas and "" escapes. */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/**
 * Extract records from a Parquet byte buffer using `hyparquet`.
 *
 * The buffer is wrapped in a minimal {@code AsyncBuffer} adapter so
 * {@code parquetReadObjects} can read it via random-access slices. Each row
 * is returned as a plain object whose keys are the parquet column names.
 */
async function extractParquet(bytes: Uint8Array): Promise<ExtractedRecord[]> {
  // Wrap the Uint8Array into hyparquet's AsyncBuffer interface.
  const asyncBuffer = {
    byteLength: bytes.byteLength,
    slice(start: number, end?: number): ArrayBuffer {
      const sliceEnd = end === undefined ? bytes.byteLength : end;
      return bytes.buffer.slice(
        bytes.byteOffset + start,
        bytes.byteOffset + sliceEnd,
      ) as ArrayBuffer;
    },
  };
  try {
    const rows = await parquetReadObjects({ file: asyncBuffer });
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return rows
      .filter((row) => row && typeof row === 'object')
      .map((row) => sanitizeParquetRow(row as Record<string, unknown>));
  } catch (err) {
    throwError(
      ERROR_CODES.INGEST_MAPPING_FAILED,
      `Invalid Parquet: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return [];
}

/**
 * Normalize a parquet row into a plain JSON-serializable record.
 *
 * hyparquet may return BigInt values for INT64 columns and TypedArrays for
 * binary columns; both are unsafe for JSON.stringify (which drops BigInt).
 * Convert BigInt → number (or string when out of safe range) and TypedArray →
 * base64 string.
 */
function sanitizeParquetRow(row: Record<string, unknown>): ExtractedRecord {
  const out: ExtractedRecord = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = sanitizeParquetValue(value);
  }
  return out;
}

function sanitizeParquetValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : value.toString();
  }
  if (value instanceof Uint8Array || ArrayBuffer.isView(value)) {
    // Binary columns: encode as base64 so the result is JSON-safe.
    const arr = value as Uint8Array;
    let binary = '';
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    // btoa is available in Workers.
    return globalThis.btoa(binary);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeParquetValue);
  }
  if (value && typeof value === 'object') {
    return sanitizeParquetRow(value as Record<string, unknown>);
  }
  return value;
}
