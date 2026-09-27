/**
 * @fileoverview The staged, re-entrant archive saga (详细设计 6.11.6).
 *
 * One cron call advances one workspace by one step. Progress lives in
 * purge_ledger: exporting → exported → mailed → purging → purged →
 * account_deleted. Every transition is a pure function here; the
 * application layer performs the I/O of the current step and persists the
 * returned patch.
 */

import {
  EXPORT_ORDER,
  PURGE_ORDER,
  isJsonLines,
  type ArchiveFile,
  type LifecycleService,
} from '@ontodecide/shared-kernel';

/** Saga phases. */
export type LedgerPhase =
  | 'exporting'
  | 'exported'
  | 'mailed'
  | 'purging'
  | 'purged'
  | 'account_deleted';

/** What the saga produces: a ZIP, only a deletion notice, or nothing. */
export type LedgerMode = 'archive' | 'no_archive' | 'empty';

/** `export_svc` value once every service has been exported. */
export const EXPORT_DONE = 'DONE';

/** Archive format version recorded in manifest.json. */
export const ARCHIVE_FORMAT_VERSION = 1;

/** Upper bound of purged rows per service per step. */
export const PURGE_STEP_ROWS = 500;

/** The persisted saga state. */
export interface Ledger {
  tenantId: string;
  phase: LedgerPhase;
  mode: LedgerMode;
  objectKey: string | null;
  exportSvc: string | null;
  exportCursor: string | null;
  parts: number;
  sizeBytes: number | null;
  sha256: string | null;
  purgeSvc: string | null;
  locale: string | null;
  timeZone: string | null;
  expiredAt: number;
  mailed: number | null;
  attempts: number;
  updatedAt: number;
}

/** Builds the ZIP object key (random 128-bit segment, generated once). */
export function archiveObjectKey(tenantId: string, randomHex: string): string {
  return `archives/${tenantId}/${randomHex}.zip`;
}

/** Staging prefix and part key. */
export function stagingPrefix(tenantId: string): string {
  return `staging/${tenantId}/`;
}

/** Key of staging part n. */
export function stagingPartKey(tenantId: string, n: number): string {
  return `${stagingPrefix(tenantId)}${n}.part`;
}

/** Chooses the saga mode when a ledger is created. */
export function chooseMode(
  deleteMode: 'archive' | 'no_archive' | null,
  totalRows: number,
): LedgerMode {
  if (deleteMode === 'no_archive') return 'no_archive';
  return totalRows === 0 ? 'empty' : 'archive';
}

/** The service to export next (null when every service is done). */
export function currentExportService(led: Ledger): LifecycleService | null {
  if (led.exportSvc === EXPORT_DONE) return null;
  return (led.exportSvc as LifecycleService | null) ?? EXPORT_ORDER[0];
}

/** Ledger fields after one exported page. */
export function advanceExport(
  svc: LifecycleService,
  nextCursor: string | null,
): {exportSvc: string; exportCursor: string | null} {
  if (nextCursor !== null) return {exportSvc: svc, exportCursor: nextCursor};
  const i = EXPORT_ORDER.indexOf(svc);
  const next = EXPORT_ORDER[i + 1];
  return {exportSvc: next ?? EXPORT_DONE, exportCursor: null};
}

/** The service to purge next. */
export function currentPurgeService(led: Ledger): LifecycleService {
  return (led.purgeSvc as LifecycleService | null) ?? PURGE_ORDER[0];
}

/** Ledger fields after one purge step. */
export function advancePurge(
  svc: LifecycleService,
  done: boolean,
): {phase: LedgerPhase; purgeSvc: string} {
  if (!done) return {phase: 'purging', purgeSvc: svc};
  const next = PURGE_ORDER[PURGE_ORDER.indexOf(svc) + 1];
  return next
    ? {phase: 'purging', purgeSvc: next}
    : {phase: 'purged', purgeSvc: svc};
}

/** Encodes a staging part: the file name on the first line, then the text. */
export function encodePart(file: ArchiveFile, text: string): string {
  return `${file}\n${text}`;
}

/** Decodes a staging part. */
export function decodePart(part: string): {file: ArchiveFile; text: string} {
  const nl = part.indexOf('\n');
  if (nl < 0) return {file: part as ArchiveFile, text: ''};
  return {file: part.slice(0, nl) as ArchiveFile, text: part.slice(nl + 1)};
}

/**
 * Concatenates staged pages into files. JSON Lines pages are joined with a
 * newline boundary; a `.json` file is a single page.
 */
export function assembleFiles(
  parts: readonly {file: ArchiveFile; text: string}[],
): Map<ArchiveFile, string> {
  const out = new Map<ArchiveFile, string>();
  for (const p of parts) {
    const prev = out.get(p.file);
    if (prev === undefined || !isJsonLines(p.file)) {
      out.set(p.file, p.text);
      continue;
    }
    if (p.text === '') continue;
    const sep = prev === '' || prev.endsWith('\n') ? '' : '\n';
    out.set(p.file, prev + sep + p.text);
  }
  return out;
}

/** Records in a file: lines of JSON Lines, array length or 1 for JSON. */
export function countRecords(file: ArchiveFile, text: string): number {
  if (isJsonLines(file)) {
    return text.split('\n').filter(l => l.trim() !== '').length;
  }
  if (text.trim() === '') return 0;
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.length : 1;
  } catch {
    return 1;
  }
}

/** One manifest entry. */
export interface ManifestFile {
  name: string;
  records: number;
  bytes: number;
  sha256: string;
}

/** manifest.json content (no e-mail, no personal data). */
export interface Manifest {
  formatVersion: number;
  product: 'OntoDecide CE';
  exportedAt: string;
  files: ManifestFile[];
}

/** Builds manifest.json. */
export function buildManifest(
  files: readonly ManifestFile[],
  exportedAt: Date,
): Manifest {
  return {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    product: 'OntoDecide CE',
    exportedAt: exportedAt.toISOString(),
    files: [...files],
  };
}

/** Bilingual README.txt placed in every archive. */
export const ARCHIVE_README = `OntoDecide CE — workspace archive / 工作区归档
==============================================

[中文]
本 ZIP 包含你的试用工作区在试用结束时的全部数据：
  ontology.json   工作区本体（对象类型、属性、关系类型、动作类型）；未修改过则只记录模板版本
  imports.json    导入作业与字段映射定义（不含原始文件）
  objects.jsonl   对象与属性值、属性血缘（每行一个对象）
  links.jsonl     关系及权重（每行一条关系）
  audit.jsonl     动作执行审计日志
  situation.json  告警历史与自动化规则
  decisions.json  情景、建议、AI 理由、确认或驳回记录
  manifest.json   文件清单、条数、SHA-256、格式版本与导出时间
如何恢复：注册新的试用后，在「数据导入」中上传 objects.jsonl 与 links.jsonl（或由其转换的 CSV），
并参照 ontology.json 重建自定义的对象类型。
你的账户信息（包括邮箱）已从系统中删除；本归档将在下载链接到期时永久删除。

[English]
This ZIP contains all data of your trial workspace at the end of the trial:
  ontology.json   the workspace ontology (object, property, link and action types);
                  only the template version when it was never modified
  imports.json    import jobs and field mappings (no raw files)
  objects.jsonl   objects, property values and lineage (one object per line)
  links.jsonl     links and weights (one link per line)
  audit.jsonl     the action execution audit log
  situation.json  alert history and automation rules
  decisions.json  scenarios, recommendations, AI rationales, confirmations and rejections
  manifest.json   file list, record counts, SHA-256, format version and export time
To restore: sign up for a new trial and upload objects.jsonl and links.jsonl (or CSV
converted from them) under "Data import"; use ontology.json to recreate custom types.
Your account information, including your e-mail address, has been deleted. This archive
is permanently deleted when the download link expires.
`;
