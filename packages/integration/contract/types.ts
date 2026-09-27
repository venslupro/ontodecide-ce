/**
 * @fileoverview Data integration DTOs (详细设计 6.11.2). File import only:
 * the browser parses CSV / XLSX / JSON and uploads rows in batches of ≤ 100,
 * written synchronously to object-graph. Raw files are never stored.
 */

/** A raw source row (column → cell value). */
export type Row = Record<string, unknown>;

/** How a mapped field was matched in a mapping draft. */
export type MatchedBy = 'exact' | 'synonym' | 'similarity' | 'ai' | 'manual';

/**
 * Field mapping from source rows to one object type. `transform` is a chain
 * such as `trim|toNumber|clamp(0,100)` (≤ 5 steps).
 */
export interface MappingSpec {
  targetType: string;
  primaryKey: {from: string; transform?: string};
  fields: {
    to: string;
    from: string;
    transform?: string;
    matchedBy?: MatchedBy;
  }[];
  /** Links created from each row; `toKey` names the column with the target key. */
  links?: {
    type: string;
    toType: string;
    toKey: string;
    /** Splits a multi-valued cell, e.g. `;`. */
    split?: string;
    weightFrom?: string;
  }[];
}

/** Row checks performed (the UI step is called 「校验」 / Validate). */
export type RowCheck = 'required' | 'type' | 'primaryKeyConflict';

/** Import job status. A job without batches for 30 min reads as FAILED. */
export type JobStatus = 'RECEIVING' | 'DONE' | 'FAILED';

/** A rejected row (column and error type only, never the cell value). */
export interface RejectDto {
  row: number;
  code: string;
  column?: string;
  detail?: string;
}

/** Import job. */
export interface JobDto {
  id: string;
  kind: 'file' | 'sample';
  fileName: string | null;
  targetType: string;
  mapping: MappingSpec | null;
  status: JobStatus;
  totalRows: number;
  received: number;
  upserted: number;
  skipped: number;
  rejected: number;
  createdAt: string;
  updatedAt: string;
  /** First ≤ 200 rejects (GET /imports/{id} only). */
  rejects?: RejectDto[];
}

/** Result of one batch (a retried seq returns the stored result). */
export interface BatchResult {
  seq: number;
  upserted: number;
  skipped: number;
  rejected: RejectDto[];
  job: Pick<
    JobDto,
    'status' | 'received' | 'upserted' | 'skipped' | 'rejected'
  >;
}

/** Mapping draft: deterministic matches first, then AI for the rest. */
export interface MappingDraft extends MappingSpec {
  rankedBy: 'ai' | 'rules';
  /** Source fields left unmatched. */
  unmatched: string[];
}

/** Input of POST /imports. */
export interface CreateImportInput {
  fileName: string;
  targetType: string;
  totalRows: number;
  mapping?: MappingSpec;
}

/** Input of POST /imports/{id}/batches. */
export interface BatchInput {
  seq: number;
  last: boolean;
  /** ≤ 100 rows. */
  rows: Row[];
}

/** Input of POST /imports/{id}/mapping-draft. */
export interface MappingDraftInput {
  fields: string[];
  /** ≤ 20 sample rows, aligned with `fields`. */
  sampleRows: unknown[][];
  targetType: string;
}

/** Sample scenario size (80 objects, 160 links). */
export const SAMPLE_SCENARIO = {objects: 80, links: 160} as const;
