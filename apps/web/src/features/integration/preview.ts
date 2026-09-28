/**
 * @fileoverview Client-side mirror of the server mapping checks
 * (`packages/integration/domain/mapping.ts` mapRows): applies the transform
 * chains of a mapping to parsed rows and performs the three CE row checks —
 * required, type (the shared `validateProps` coercion) and primary key
 * empty / duplicated within the file — plus the upload plan
 * (min(remaining import rows today, object headroom, link headroom for
 * mappings with links)); rows beyond it are marked 「超出上限」 and are not
 * submitted.
 */

import type {MappingSpec, RejectDto} from '@ontodecide/integration/contract';
import {
  validateProps,
  type CompiledObjectType,
  type PropertyDef,
} from '@ontodecide/ontology/contract';
import {CE_LIMITS} from '@ontodecide/shared-kernel';
import type {UiObjectType} from '../../entities/schema/model';
import type {SourceRow} from '../../workers/parse_core';
import {compileChain, TransformError} from './transform';

/** Reject codes (same strings as the server) plus the client-only limit code. */
export const REJECT_CODES = {
  primaryKeyMissing: 'PRIMARY_KEY_MISSING',
  primaryKeyConflict: 'PRIMARY_KEY_CONFLICT',
  required: 'REQUIRED',
  type: 'TYPE',
  transformFailed: 'TRANSFORM_FAILED',
  overLimit: 'OVER_LIMIT',
} as const;

/** Builds the compiled-type shape `validateProps` needs from the UI model. */
export function compiledTypeOf(type: UiObjectType): CompiledObjectType {
  const properties: PropertyDef[] = type.properties.map(p => ({
    apiName: p.apiName,
    displayName: p.displayName,
    dataType: p.dataType,
    required: p.required,
    enumValues: p.enumValues,
    sensitive: p.sensitive,
  }));
  return {
    apiName: type.apiName,
    displayName: type.displayName,
    primaryKey: type.primaryKey,
    titleProperty: type.titleProperty,
    properties,
    propsByName: Object.fromEntries(properties.map(p => [p.apiName, p])),
    indexedProps: [],
    sensitiveProps: properties.filter(p => p.sensitive).map(p => p.apiName),
  };
}

/** Outcome of mapping one row (1-based `row` = file data row). */
export type RowOutcome =
  | {
      ok: true;
      row: number;
      primaryKey: string;
      props: Record<string, unknown>;
      linkCount: number;
    }
  | ({ok: false} & RejectDto);

function blank(v: unknown): boolean {
  return (
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  );
}

function linkKeys(value: unknown, split?: string): string[] {
  if (blank(value)) return [];
  const parts = Array.isArray(value)
    ? value.map(String)
    : split
      ? String(value).split(split)
      : [String(value)];
  return parts.map(s => s.trim()).filter(s => s !== '');
}

class RowReject extends Error {
  constructor(
    readonly code: string,
    readonly column?: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}

/**
 * Maps rows with the mapping (same order of checks as the server; the
 * first failing check wins). `firstRow` is the row number of `rows[0]`.
 */
export function mapRowsPreview(
  rows: readonly SourceRow[],
  spec: MappingSpec,
  type: UiObjectType,
  firstRow = 1,
): RowOutcome[] {
  const compiled = compiledTypeOf(type);
  const pkChain = compileChain(spec.primaryKey.transform);
  const chains = spec.fields.map(f => ({f, chain: compileChain(f.transform)}));
  const columnOf = new Map<string, string>();
  for (const f of spec.fields) columnOf.set(f.to, f.from);
  if (!columnOf.has(type.primaryKey)) {
    columnOf.set(type.primaryKey, spec.primaryKey.from);
  }
  const seen = new Set<string>();
  return rows.map((raw, i): RowOutcome => {
    const row = firstRow + i;
    try {
      const pkCol = spec.primaryKey.from;
      let pk: unknown;
      try {
        pk = pkChain.apply(raw[pkCol]);
      } catch (e) {
        if (e instanceof TransformError) {
          throw new RowReject(REJECT_CODES.transformFailed, pkCol, e.step);
        }
        throw e;
      }
      if (blank(pk) || typeof pk === 'object') {
        throw new RowReject(REJECT_CODES.primaryKeyMissing, pkCol);
      }
      const primaryKey = String(pk).trim();
      if (seen.has(primaryKey)) {
        throw new RowReject(REJECT_CODES.primaryKeyConflict, pkCol);
      }
      const values: Record<string, unknown> = {};
      for (const {f, chain} of chains) {
        try {
          values[f.to] = chain.apply(raw[f.from]);
        } catch (e) {
          if (e instanceof TransformError) {
            throw new RowReject(REJECT_CODES.transformFailed, f.from, e.step);
          }
          throw e;
        }
      }
      if (blank(values[type.primaryKey])) values[type.primaryKey] = primaryKey;
      const {props, errors} = validateProps(compiled, values);
      if (errors.length > 0) {
        const err = errors[0];
        throw new RowReject(
          err.code === 'REQUIRED' ? REJECT_CODES.required : REJECT_CODES.type,
          columnOf.get(err.prop),
          err.detail,
        );
      }
      let linkCount = 0;
      for (const l of spec.links ?? []) {
        linkCount += linkKeys(raw[l.toKey], l.split).length;
      }
      seen.add(primaryKey);
      return {ok: true, row, primaryKey, props, linkCount};
    } catch (e) {
      if (!(e instanceof RowReject)) throw e;
      return {
        ok: false,
        row,
        code: e.code,
        ...(e.column ? {column: e.column} : {}),
        ...(e.detail ? {detail: e.detail} : {}),
      };
    }
  });
}

/** What limited the upload plan. */
export type PlanLimit = 'importRows' | 'objects' | 'links' | 'batchMax';

/**
 * Links each raw row would create under `spec` (multi-valued cells split),
 * in file order. Empty when the mapping has no links.
 */
export function rowLinkCounts(
  rows: readonly SourceRow[],
  spec: Pick<MappingSpec, 'links'> | null | undefined,
): number[] {
  const links = spec?.links ?? [];
  if (links.length === 0) return [];
  return rows.map(raw =>
    links.reduce((n, l) => n + linkKeys(raw[l.toKey], l.split).length, 0),
  );
}

/** Largest prefix of rows whose links fit in `linksLeft`. */
export function rowsWithinLinks(
  linkCounts: readonly number[],
  linksLeft: number,
): number {
  let sum = 0;
  for (let i = 0; i < linkCounts.length; i++) {
    sum += linkCounts[i];
    if (sum > linksLeft) return i;
  }
  return linkCounts.length;
}

/** Upload plan of one file. */
export interface UploadPlan {
  totalRows: number;
  /** Rows submitted (the first `submitRows` rows of the file). */
  submitRows: number;
  /** Rows beyond the limits (marked 「超出上限」, not submitted). */
  overLimitRows: number;
  limitedBy: PlanLimit | null;
  /** Row-count estimate of batches (≤ 100 rows each). */
  batches: number;
  batchRows: number;
  /** Rough duration estimate in seconds (≈ 1 s per batch). */
  estimatedSeconds: number;
}

/** Remaining amounts that bound an import. */
export interface PlanQuota {
  /** Import rows left today. */
  importRowsLeft: number;
  /** Objects that can still be created (limit − objects). */
  objectsLeft: number;
  /** Links that can still be created (limit − links). */
  linksLeft?: number;
}

/** Seconds per batch used for the estimate. */
export const SECONDS_PER_BATCH = 1;

/**
 * Computes the upload plan (前端详细设计 算法描述 文件导入 预检额度):
 * min(import rows left today, objects left, rows whose links fit in the
 * links left). `linkCounts` (see {@link rowLinkCounts}) is only given for
 * mappings with links.
 */
export function planUpload(
  totalRows: number,
  quota: PlanQuota,
  batchRows: number = CE_LIMITS.batchRows,
  linkCounts: readonly number[] = [],
): UploadPlan {
  const caps: [PlanLimit, number][] = [
    ['importRows', Math.max(0, quota.importRowsLeft)],
    ['objects', Math.max(0, quota.objectsLeft)],
  ];
  if (linkCounts.length > 0 && quota.linksLeft !== undefined) {
    caps.push([
      'links',
      rowsWithinLinks(linkCounts, Math.max(0, quota.linksLeft)),
    ]);
  }
  caps.push(['batchMax', CE_LIMITS.importRowsDaily]);
  let submitRows = totalRows;
  let limitedBy: PlanLimit | null = null;
  for (const [k, cap] of caps) {
    if (cap < submitRows) {
      submitRows = cap;
      limitedBy = k;
    }
  }
  const batches = Math.ceil(submitRows / batchRows);
  return {
    totalRows,
    submitRows,
    overLimitRows: totalRows - submitRows,
    limitedBy,
    batches,
    batchRows: Math.min(batchRows, submitRows),
    estimatedSeconds: Math.max(
      submitRows > 0 ? 1 : 0,
      batches * SECONDS_PER_BATCH,
    ),
  };
}

/** Validation summary of the whole file (校验 step). */
export interface ValidationSummary {
  outcomes: RowOutcome[];
  passed: number;
  rejected: number;
  overLimit: number;
  /** Reject counts by code (over-limit excluded). */
  byCode: Record<string, number>;
  /** Rejected rows in row order (over-limit rows excluded). */
  rejects: RejectDto[];
}

/**
 * Validates every row within the plan; rows beyond `plan.submitRows` are
 * counted as over-limit (they are not checked or submitted).
 */
export function validateRows(
  rows: readonly SourceRow[],
  spec: MappingSpec,
  type: UiObjectType,
  plan: Pick<UploadPlan, 'submitRows'>,
): ValidationSummary {
  const outcomes = mapRowsPreview(rows.slice(0, plan.submitRows), spec, type);
  const byCode: Record<string, number> = {};
  const rejects: RejectDto[] = [];
  let passed = 0;
  for (const o of outcomes) {
    if (o.ok) {
      passed++;
      continue;
    }
    byCode[o.code] = (byCode[o.code] ?? 0) + 1;
    const {ok: _ok, ...reject} = o;
    rejects.push(reject);
  }
  return {
    outcomes,
    passed,
    rejected: rejects.length,
    overLimit: Math.max(0, rows.length - plan.submitRows),
    byCode,
    rejects,
  };
}

/** Projects rows onto the columns the mapping uses (nothing else is sent). */
export function projectRows(
  rows: readonly SourceRow[],
  columns: readonly string[],
): SourceRow[] {
  return rows.map(r => {
    const out: SourceRow = {};
    for (const c of columns) if (c in r) out[c] = r[c];
    return out;
  });
}
