/**
 * @fileoverview TenantLifecycle: the export / purge / count entry point that
 * each data-owning service exposes as a separate WorkerEntrypoint, bound only
 * to identity-access (修订说明书 12.7 接口隔离). api-gateway never binds it,
 * so it cannot call purgeTenant.
 */

/** Files of an archive ZIP and of `GET /me/export` (修订说明书 9.3). */
export const ARCHIVE_FILES = [
  'ontology.json',
  'imports.json',
  'objects.jsonl',
  'links.jsonl',
  'audit.jsonl',
  'situation.json',
  'decisions.json',
] as const;

/** A file produced by exportTenant. */
export type ArchiveFile = (typeof ARCHIVE_FILES)[number];

/** Whether a file is JSON Lines (paged) rather than one JSON document. */
export function isJsonLines(file: ArchiveFile): boolean {
  return file.endsWith('.jsonl');
}

/**
 * One export page: ≤ 2,000 rows and ≤ 900 KB. JSON Lines files may span
 * several pages (their texts are concatenated); a `.json` file is always a
 * single page. `nextCursor` null means the service is done.
 */
export interface ExportPage {
  file: ArchiveFile;
  text: string;
  nextCursor: string | null;
}

/** Result of one purge step. */
export interface PurgeResult {
  deleted: number;
  /** True once no row is left; the service has written its tombstone. */
  done: boolean;
}

/** WebSocket close code sent when a trial ends. */
export const STREAM_CLOSE_EXPIRED = 4401;

/** Lifecycle entry point implemented by the five data-owning services. */
export interface TenantLifecycleRpc {
  /** Cursor-paged export; `cursor` null starts from the beginning. */
  exportTenant(tenantId: string, cursor: string | null): Promise<ExportPage>;
  /**
   * Deletes up to `maxRows` (≤ 500) rows. When nothing is left, writes the
   * local tenant tombstone (kept 48 h) and reports done.
   */
  purgeTenant(tenantId: string, maxRows: number): Promise<PurgeResult>;
  /** Rows the service still holds for the workspace. */
  countTenant(tenantId: string): Promise<number>;
  /** situation-awareness only: closes the workspace's WebSockets. */
  closeStreams?(tenantId: string, code: number): Promise<void>;
}

/** Services exposing a TenantLifecycle entry point. */
export type LifecycleService =
  'ontology' | 'integration' | 'objects' | 'situation' | 'decision';

/** Export order (详细设计 6.11.6). */
export const EXPORT_ORDER: readonly LifecycleService[] = [
  'ontology',
  'integration',
  'objects',
  'situation',
  'decision',
];

/** Purge order: consumers of data first, the ontology last. */
export const PURGE_ORDER: readonly LifecycleService[] = [
  'situation',
  'decision',
  'objects',
  'integration',
  'ontology',
];

/** One line of the `GET /me/export` JSON Lines stream. */
export interface ExportRecord {
  file: ArchiveFile;
  /** A JSON Lines record, or the whole document of a `.json` file. */
  data: unknown;
}
