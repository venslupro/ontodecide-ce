/**
 * @fileoverview Main-thread facade over the parse Web Worker. Falls back to
 * parsing on the main thread when `Worker` is unavailable (jsdom, very old
 * browsers). The file is read locally only; nothing is uploaded.
 */

import {
  handleParseRequest,
  ParseError,
  precheckFile,
  type ParsedTable,
  type ParseLimits,
  type ParseRequest,
  type ParseResponse,
} from '../../workers/parse_core';

export {ParseError};
export type {ParsedTable};

/** A file parsed in the browser. */
export interface ParsedFile extends ParsedTable {
  name: string;
  size: number;
}

/** Options for {@link parseFile}. */
export interface ParseFileOptions {
  limits?: Partial<ParseLimits>;
  /** Forces the main-thread parser. */
  forceMainThread?: boolean;
  signal?: AbortSignal;
}

function runInWorker(req: ParseRequest, signal?: AbortSignal) {
  return new Promise<ParseResponse>((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/parse_worker.ts', import.meta.url),
      {type: 'module'},
    );
    const done = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      reject(new ParseError('PARSE_FAILED', 'aborted'));
    };
    signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      done();
      resolve(e.data);
    };
    worker.onerror = e => {
      done();
      resolve({ok: false, code: 'PARSE_FAILED', detail: e.message});
    };
    worker.postMessage(req);
  });
}

/**
 * Parses `file` (in the Worker when available). Rejects with a
 * {@link ParseError}; size and format are checked before reading.
 */
export async function parseFile(
  file: File,
  opts: ParseFileOptions = {},
): Promise<ParsedFile> {
  const pre = precheckFile(file, opts.limits);
  if (pre) throw pre;
  const req: ParseRequest = {
    name: file.name,
    size: file.size,
    type: file.type,
    data: file,
    limits: opts.limits,
  };
  const useWorker = !opts.forceMainThread && typeof Worker !== 'undefined';
  let res: ParseResponse;
  if (useWorker) {
    try {
      res = await runInWorker(req, opts.signal);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      res = await handleParseRequest(req);
    }
  } else {
    res = await handleParseRequest(req);
  }
  if (!res.ok) throw new ParseError(res.code, res.detail);
  return {...res.table, name: file.name, size: file.size};
}
