/**
 * @fileoverview Web Worker that parses an import file off the main thread
 * (CSV / XLSX / JSON) and posts one {@link ParseResponse}. All logic lives
 * in the pure `parse_core`. Loaded with
 * `new Worker(new URL('./parse_worker.ts', import.meta.url), {type: 'module'})`.
 */

import {
  handleParseRequest,
  type ParseRequest,
  type ParseResponse,
} from './parse_core';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: ParseResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = e => {
  void handleParseRequest(e.data).then(res => scope.postMessage(res));
};
