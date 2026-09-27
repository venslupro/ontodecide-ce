/**
 * @fileoverview Identity: `GET /me/export` chunks (JSON Lines of
 * ExportRecord) built from the TenantLifecycle export pages of the five
 * services in EXPORT_ORDER. The cursor carries the service index and that
 * service's own cursor.
 */

import {
  AppError,
  EXPORT_ORDER,
  decodeCursor,
  encodeCursor,
  isJsonLines,
  type CallCtx,
  type ExportPage,
  type ExportRecord,
} from '@ontodecide/shared-kernel';
import type {ExportChunk} from '../../contract';
import type {Lifecycles} from '../ports';

interface ExportCursor {
  s: number;
  c: string | null;
}

/** Converts one export page into JSON Lines of ExportRecord. */
export function pageToRecords(page: ExportPage): string {
  const records: ExportRecord[] = [];
  if (isJsonLines(page.file)) {
    for (const line of page.text.split('\n')) {
      if (line.trim() === '') continue;
      records.push({file: page.file, data: JSON.parse(line) as unknown});
    }
  } else if (page.text.trim() !== '') {
    records.push({file: page.file, data: JSON.parse(page.text) as unknown});
  }
  return records.map(r => JSON.stringify(r) + '\n').join('');
}

/** Workspace export for the owner (or the admin under Act-as). */
export class ExportService {
  constructor(private readonly lifecycles: Lifecycles) {}

  async chunk(ctx: CallCtx, cursor: string | null): Promise<ExportChunk> {
    if (ctx.actor.role === 'service') throw new AppError('FORBIDDEN');
    const pos: ExportCursor = cursor
      ? (decodeCursor<ExportCursor>(cursor) ?? {s: -1, c: null})
      : {s: 0, c: null};
    if (!Number.isInteger(pos.s) || pos.s < 0 || pos.s >= EXPORT_ORDER.length) {
      throw new AppError('VALIDATION_FAILED', 'Bad cursor');
    }
    const svc = EXPORT_ORDER[pos.s];
    const page = await this.lifecycles[svc].exportTenant(ctx.tid, pos.c);
    const text = pageToRecords(page);
    let next: ExportCursor | null;
    if (page.nextCursor !== null) next = {s: pos.s, c: page.nextCursor};
    else if (pos.s + 1 < EXPORT_ORDER.length) next = {s: pos.s + 1, c: null};
    else next = null;
    return {text, nextCursor: next ? encodeCursor({...next}) : null};
  }
}
