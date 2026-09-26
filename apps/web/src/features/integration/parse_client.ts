/**
 * @fileoverview Main-thread facade over the parse Web Worker. Runs the pure
 * parser on the main thread when `Worker` is unavailable (jsdom / very old
 * browsers). Collects the streamed batches into one {@link ParsedFile}.
 */

import {
  blobText,
  DEFAULT_PARSE_LIMITS,
  detectFormat,
  parseFile,
  type FileFormat,
  type ParseErrorCode,
  type ParseLimits,
  type ParseMessage,
  type ParseRequest,
  type SourceRow,
} from '../../workers/parse_core';

export type {FileFormat, ParseErrorCode, SourceRow};

/** Result of parsing one file in the browser. */
export interface ParsedFile {
  name: string;
  size: number;
  format: FileFormat;
  fields: string[];
  rows: SourceRow[];
  sampleRows: SourceRow[];
  /** Parse duration in milliseconds. */
  ms: number;
  /** The original file (archived to B2 when configured). */
  file: Blob;
}

/** A parse failure with a localizable code. */
export class ParseFailure extends Error {
  constructor(
    readonly code: ParseErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ParseFailure';
  }
}

/** Options for {@link parseInBrowser}. */
export interface ParseOptions {
  /** Called with the number of rows received so far. */
  onProgress?: (rows: number) => void;
  limits?: Partial<ParseLimits>;
  /** Forces the main-thread parser (tests). */
  forceMainThread?: boolean;
}

/** A running parse. */
export interface ParseHandle {
  promise: Promise<ParsedFile>;
  cancel(): void;
}

/** Cheap pre-checks before reading the file (format, size). */
export function precheckFile(
  file: {name: string; size: number; type?: string},
  limits: Partial<ParseLimits> = {},
): ParseFailure | null {
  const max = limits.bytesMax ?? DEFAULT_PARSE_LIMITS.bytesMax;
  if (!detectFormat(file.name, file.type ?? ''))
    return new ParseFailure('UNSUPPORTED_FORMAT', file.name);
  if (file.size > max)
    return new ParseFailure('FILE_TOO_LARGE', String(file.size));
  if (file.size === 0) return new ParseFailure('EMPTY_FILE');
  return null;
}

/** Parses `file` (in the Worker when available) and collects every row. */
export function parseInBrowser(
  file: File,
  opts: ParseOptions = {},
): ParseHandle {
  let cancel = () => {};
  const promise = new Promise<ParsedFile>((resolve, reject) => {
    const pre = precheckFile(file, opts.limits);
    if (pre) {
      reject(pre);
      return;
    }
    const format = detectFormat(file.name, file.type)!;
    let fields: string[] = [];
    let sampleRows: SourceRow[] = [];
    const rows: SourceRow[] = [];
    let settled = false;
    const handle = (m: ParseMessage) => {
      if (settled) return;
      switch (m.type) {
        case 'meta':
          fields = m.fields;
          sampleRows = m.sampleRows;
          break;
        case 'batch':
          for (const r of m.rows) rows.push(r);
          opts.onProgress?.(rows.length);
          break;
        case 'done':
          settled = true;
          resolve({
            name: file.name,
            size: file.size,
            format,
            fields,
            rows,
            sampleRows,
            ms: m.ms,
            file,
          });
          break;
        case 'error':
          settled = true;
          reject(new ParseFailure(m.code, m.detail));
          break;
      }
    };

    const useWorker = !opts.forceMainThread && typeof Worker !== 'undefined';
    if (useWorker) {
      let worker: Worker;
      try {
        worker = new Worker(
          new URL('../../workers/parse_worker.ts', import.meta.url),
          {type: 'module'},
        );
      } catch (e) {
        reject(
          new ParseFailure(
            'PARSE_FAILED',
            e instanceof Error ? e.message : String(e),
          ),
        );
        return;
      }
      const finish = () => worker.terminate();
      worker.onmessage = (e: MessageEvent<ParseMessage>) => {
        handle(e.data);
        if (settled) finish();
      };
      worker.onerror = e => {
        handle({type: 'error', code: 'PARSE_FAILED', detail: e.message});
        finish();
      };
      cancel = () => {
        settled = true;
        finish();
        reject(new ParseFailure('PARSE_FAILED', 'cancelled'));
      };
      const req: ParseRequest = {
        name: file.name,
        size: file.size,
        data: file,
        limits: opts.limits,
      };
      worker.postMessage(req);
      return;
    }

    cancel = () => {
      if (settled) return;
      settled = true;
      reject(new ParseFailure('PARSE_FAILED', 'cancelled'));
    };
    void (async () => {
      try {
        // Text formats are read up front on the main thread (jsdom's File
        // streaming is incomplete); XLSX needs the binary Blob.
        const data = format === 'xlsx' ? file : await blobText(file);
        await parseFile(
          {name: file.name, size: file.size, data, limits: opts.limits},
          handle,
        );
      } catch (e) {
        handle({
          type: 'error',
          code: 'PARSE_FAILED',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  });
  return {promise, cancel: () => cancel()};
}
