/**
 * @fileoverview Mapping engine (详细设计 6.11.2): validates a MappingSpec
 * against the compiled ontology and turns source rows into object-graph
 * UpsertCmds, performing the three CE row checks — required, type (through
 * the ontology's `validateProps`) and primary-key conflict within the job.
 * Rejects carry the column and an error code only, never the cell value.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {validateProps} from '@ontodecide/ontology/contract';
import type {
  CompiledObjectType,
  CompiledSchema,
  ValidationIssue,
} from '@ontodecide/ontology/contract';
import type {UpsertCmd} from '@ontodecide/object-graph/contract';
import type {MappingSpec, RejectDto, Row} from '../contract';
import {compileChain, TransformError} from './transforms';

/** Reject codes produced by mapping (object-graph adds its own codes). */
export const REJECT_CODES = {
  primaryKeyMissing: 'PRIMARY_KEY_MISSING',
  primaryKeyConflict: 'PRIMARY_KEY_CONFLICT',
  required: 'REQUIRED',
  type: 'TYPE',
  transformFailed: 'TRANSFORM_FAILED',
} as const;

/** Largest separator accepted for multi-valued link cells. */
const MAX_SPLIT_LENGTH = 4;

function compiles(expr: string | undefined): string | null {
  try {
    compileChain(expr);
    return null;
  } catch (e) {
    return e instanceof AppError ? (e.detail ?? e.code) : String(e);
  }
}

/**
 * Checks a mapping against the compiled schema: the target type, target
 * properties and link types exist, transforms compile (≤ 5 steps), every
 * required property is mapped and no property is mapped twice.
 */
export function mappingIssues(
  spec: MappingSpec,
  schema: CompiledSchema,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const type = schema.objectTypes[spec.targetType];
  if (!type) {
    return [{path: 'targetType', message: `Unknown type ${spec.targetType}`}];
  }
  if (!spec.primaryKey.from) {
    issues.push({path: 'primaryKey.from', message: 'Column is required'});
  }
  const pkErr = compiles(spec.primaryKey.transform);
  if (pkErr) issues.push({path: 'primaryKey.transform', message: pkErr});
  const mapped = new Set<string>();
  spec.fields.forEach((f, i) => {
    if (!type.propsByName[f.to]) {
      issues.push({
        path: `fields.${i}.to`,
        message: `Unknown property ${f.to}`,
      });
    } else if (mapped.has(f.to)) {
      issues.push({path: `fields.${i}.to`, message: `Mapped twice: ${f.to}`});
    }
    mapped.add(f.to);
    const err = compiles(f.transform);
    if (err) issues.push({path: `fields.${i}.transform`, message: err});
  });
  for (const p of type.properties) {
    if (p.required && p.apiName !== type.primaryKey && !mapped.has(p.apiName)) {
      issues.push({path: 'fields', message: `Required property ${p.apiName}`});
    }
  }
  (spec.links ?? []).forEach((l, i) => {
    const lt = schema.linkTypes[l.type];
    if (!lt) {
      issues.push({path: `links.${i}.type`, message: `Unknown link ${l.type}`});
    } else if (lt.from !== spec.targetType || lt.to !== l.toType) {
      issues.push({
        path: `links.${i}.toType`,
        message: `${l.type} links ${lt.from} to ${lt.to}`,
      });
    }
    if (l.split !== undefined && l.split.length > MAX_SPLIT_LENGTH) {
      issues.push({path: `links.${i}.split`, message: 'Separator too long'});
    }
  });
  return issues;
}

/** Throws VALIDATION_FAILED (with `errors`) when the mapping is invalid. */
export function assertMapping(
  spec: MappingSpec,
  schema: CompiledSchema,
): CompiledObjectType {
  const issues = mappingIssues(spec, schema);
  if (issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', issues[0].message, {
      extras: {errors: issues},
    });
  }
  return schema.objectTypes[spec.targetType];
}

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

/** Key identifying an object within a job (type + primary key). */
export function objectKey(type: string, primaryKey: string): string {
  return `${type}:${primaryKey}`;
}

/** Input of {@link mapRows}. */
export interface MapRowsInput {
  rows: readonly Row[];
  /** Job row number (1-based) of `rows[0]`. */
  firstRow: number;
  mapping: MappingSpec;
  type: CompiledObjectType;
  /** Object keys accepted by earlier batches of the job (not mutated). */
  seen: ReadonlySet<string>;
}

/** Output of {@link mapRows}. */
export interface MapRowsOutput {
  cmds: UpsertCmd[];
  rejects: RejectDto[];
  /** Object keys accepted in this batch (see {@link objectKey}). */
  keys: string[];
}

class RowReject extends Error {
  constructor(
    readonly code: string,
    readonly column: string | undefined,
    readonly detail?: string,
  ) {
    super(code);
  }
}

/**
 * Maps a batch of rows. Each rejected row yields one reject (the first
 * failing check); accepted rows become UpsertCmds with coerced props and
 * links (multi-valued cells split by `split`, weights from `weightFrom`).
 */
export function mapRows(input: MapRowsInput): MapRowsOutput {
  const {mapping, type} = input;
  const pkChain = compileChain(mapping.primaryKey.transform);
  const fieldChains = mapping.fields.map(f => ({
    f,
    chain: compileChain(f.transform),
  }));
  const toNumber = compileChain('toNumber');
  const columnOf = new Map<string, string>();
  for (const f of mapping.fields) columnOf.set(f.to, f.from);
  if (!columnOf.has(type.primaryKey)) {
    columnOf.set(type.primaryKey, mapping.primaryKey.from);
  }

  const seen = new Set(input.seen);
  const out: MapRowsOutput = {cmds: [], rejects: [], keys: []};

  input.rows.forEach((raw, i) => {
    const row = input.firstRow + i;
    try {
      const pkCol = mapping.primaryKey.from;
      let pkValue: unknown;
      try {
        pkValue = pkChain.apply(raw[pkCol]);
      } catch (e) {
        if (e instanceof TransformError) {
          throw new RowReject(REJECT_CODES.transformFailed, pkCol, e.step);
        }
        throw e;
      }
      if (blank(pkValue) || typeof pkValue === 'object') {
        throw new RowReject(REJECT_CODES.primaryKeyMissing, pkCol);
      }
      const primaryKey = String(pkValue).trim();
      const key = objectKey(type.apiName, primaryKey);
      if (seen.has(key)) {
        throw new RowReject(REJECT_CODES.primaryKeyConflict, pkCol);
      }

      const values: Record<string, unknown> = {};
      for (const {f, chain} of fieldChains) {
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

      const {props, errors} = validateProps(type, values);
      if (errors.length > 0) {
        const err = errors[0];
        throw new RowReject(
          err.code === 'REQUIRED' ? REJECT_CODES.required : REJECT_CODES.type,
          columnOf.get(err.prop),
          err.detail,
        );
      }

      const links: NonNullable<UpsertCmd['links']> = [];
      for (const l of mapping.links ?? []) {
        let weight: number | undefined;
        if (l.weightFrom && !blank(raw[l.weightFrom])) {
          let n: unknown;
          try {
            n = toNumber.apply(raw[l.weightFrom]);
          } catch {
            n = null;
          }
          if (typeof n !== 'number') {
            throw new RowReject(REJECT_CODES.type, l.weightFrom, 'weight');
          }
          weight = n;
        }
        for (const toKey of linkKeys(raw[l.toKey], l.split)) {
          links.push({
            type: l.type,
            toType: l.toType,
            toKey,
            ...(weight !== undefined ? {weight} : {}),
          });
        }
      }

      seen.add(key);
      out.keys.push(key);
      out.cmds.push({
        type: type.apiName,
        primaryKey,
        props,
        row,
        ...(links.length > 0 ? {links} : {}),
      });
    } catch (e) {
      if (!(e instanceof RowReject)) throw e;
      out.rejects.push({
        row,
        code: e.code,
        ...(e.column ? {column: e.column} : {}),
        ...(e.detail ? {detail: e.detail} : {}),
      });
    }
  });
  return out;
}
