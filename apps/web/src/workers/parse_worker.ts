/**
 * @fileoverview Web Worker that parses an uploaded file off the main thread
 * (PapaParse streaming for CSV, SheetJS for XLSX, JSON arrays) and posts
 * `meta`, `batch` (every 500 rows), `done` / `error` messages. All logic
 * lives in the pure {@link parseFile}.
 */

import {parseFile, type ParseMessage, type ParseRequest} from './parse_core';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: ParseMessage): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = e => {
  void parseFile(e.data, m => scope.postMessage(m));
};
