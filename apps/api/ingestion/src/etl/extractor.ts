/**
 * Extractor: turn raw file bytes (CSV / JSON / Parquet) into a uniform list
 * of record objects.
 *
 * Workers don't have native Parquet support, so Parquet files are rejected
 * with a clear error message inviting the operator to convert to CSV. CSV is
 * parsed with a minimal hand-rolled parser that handles quoted fields and
 * escaped quotes; for production-grade parsing, swap in `papaparse` (the
 * worker bundle can include it under `nodejs_compat`).
 */
import { ERROR_CODES, throwError } from '@ontodecide/shared';

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
      throwError(
        ERROR_CODES.INGEST_FORMAT_UNSUPPORTED,
        'Parquet is not supported in Workers; convert to CSV or JSON.',
      );
      break;
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
