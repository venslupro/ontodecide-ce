/**
 * @fileoverview Mapping engine: turns one source record into an UpsertCmd
 * (primary key, transformed props validated against the compiled target
 * type, links, provenance) or a rejection.
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {Provenance} from '@ontodecide/shared-kernel';
import {validateProps} from '@ontodecide/ontology/contract';
import type {
  CompiledModel,
  CompiledObjectType,
} from '@ontodecide/ontology/contract';
import type {MappingSpec, QualityRule, UpsertCmd} from '../contract';
import {applyQualityRules, validateQualityRules} from './quality';
import {compileChain, TransformError} from './transforms';

/** Rejection codes produced by mapping. */
export const REJECT_CODES = {
  primaryKeyMissing: 'PRIMARY_KEY_MISSING',
  transformFailed: 'TRANSFORM_FAILED',
  propInvalid: 'PROP_INVALID',
  schemaMismatch: 'SCHEMA_MISMATCH',
  sourceUnavailable: 'SOURCE_UNAVAILABLE',
} as const;

/** A record that could not be mapped. */
export interface Rejection {
  row: number;
  code: string;
  detail: string;
}

/** Result of mapping one record. */
export type MapResult =
  | {ok: true; cmd: UpsertCmd; warnings: string[]}
  | {ok: false; rejection: Rejection};

/** Context shared by every record of a message. */
export interface MappingContext {
  mapping: MappingSpec;
  qualityRules: readonly QualityRule[];
  targetType: CompiledObjectType;
  /** Provenance fields common to the message. */
  provenance: Omit<Provenance, 'recordRef' | 'sourceTs'>;
  now: Date;
}

/**
 * Validates a mapping's transforms and quality rules (and, when a model is
 * given, that the target and link types exist). Throws VALIDATION_FAILED.
 */
export function validateMapping(
  mapping: MappingSpec,
  rules: readonly QualityRule[] = [],
  model?: CompiledModel,
): void {
  compileChain(mapping.primaryKey.transform);
  for (const f of mapping.fields) compileChain(f.transform);
  validateQualityRules(rules);
  if (model) {
    if (!model.objectTypes[mapping.targetType]) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Unknown target type ${mapping.targetType}`,
      );
    }
    for (const l of mapping.links ?? []) {
      if (!model.linkTypes[l.type]) {
        throw new AppError('VALIDATION_FAILED', `Unknown link type ${l.type}`);
      }
    }
  }
}

/** Resolves the compiled target type or throws SCHEMA_MISMATCH-style info. */
export function resolveTargetType(
  model: CompiledModel,
  mapping: MappingSpec,
): CompiledObjectType | null {
  return model.objectTypes[mapping.targetType] ?? null;
}

function blank(v: unknown): boolean {
  return (
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  );
}

function toIso(v: unknown): string | undefined {
  if (blank(v)) return undefined;
  const raw = typeof v === 'number' && v < 1e11 ? v * 1000 : v;
  const d = new Date(raw as string | number);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
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

/** Maps one record (row number `row`, 1-based within the job). */
export function mapRecord(
  record: Record<string, unknown>,
  row: number,
  ctx: MappingContext,
): MapResult {
  const {mapping, targetType} = ctx;
  const reject = (code: string, detail: string): MapResult => ({
    ok: false,
    rejection: {row, code, detail},
  });
  try {
    const pkRaw = record[mapping.primaryKey.from];
    const pkValue = compileChain(mapping.primaryKey.transform).apply(pkRaw);
    if (blank(pkValue) || typeof pkValue === 'object') {
      return reject(
        REJECT_CODES.primaryKeyMissing,
        `${mapping.primaryKey.from} is empty`,
      );
    }
    const primaryKey = String(pkValue).trim();

    const input: Record<string, unknown> = {};
    for (const f of mapping.fields) {
      input[f.to] = compileChain(f.transform).apply(record[f.from]);
    }
    if (blank(input[targetType.primaryKey]))
      input[targetType.primaryKey] = primaryKey;

    const {props, errors} = validateProps(targetType, input, {partial: true});
    if (errors.length > 0) {
      return reject(
        REJECT_CODES.propInvalid,
        errors.map(e => `${e.prop}: ${e.code} ${e.detail}`).join('; '),
      );
    }

    const sourceTs = mapping.sourceTsFrom
      ? toIso(record[mapping.sourceTsFrom])
      : undefined;
    const quality = applyQualityRules(ctx.qualityRules, {
      props,
      record,
      sourceTs,
      now: ctx.now,
    });
    if (!quality.ok) return reject(quality.code, quality.detail);

    const links: UpsertCmd['links'] = [];
    for (const l of mapping.links ?? []) {
      const weightRaw = l.weightFrom ? record[l.weightFrom] : undefined;
      let weight: number | undefined;
      if (!blank(weightRaw)) {
        const n =
          typeof weightRaw === 'number'
            ? weightRaw
            : Number(String(weightRaw).trim());
        if (!Number.isFinite(n)) {
          return reject(
            REJECT_CODES.transformFailed,
            `${l.weightFrom}: weight is not a number`,
          );
        }
        weight = n;
      }
      for (const toKey of linkKeys(record[l.toKey], l.split)) {
        links.push({
          type: l.type,
          toType: l.toType,
          toKey,
          ...(weight !== undefined ? {weight} : {}),
        });
      }
    }

    const provenance: Provenance = {
      ...ctx.provenance,
      recordRef: `${ctx.provenance.datasetTxn}:${row}`,
      ...(sourceTs ? {sourceTs} : {}),
    };
    const cmd: UpsertCmd = {
      type: targetType.apiName,
      primaryKey,
      props: quality.props,
      links,
      provenance,
      row,
    };
    if (
      !blank(pkRaw) &&
      typeof pkRaw !== 'object' &&
      String(pkRaw) !== primaryKey
    ) {
      cmd.externalKey = String(pkRaw);
    }
    return {ok: true, cmd, warnings: quality.warnings};
  } catch (e) {
    if (e instanceof TransformError)
      return reject(REJECT_CODES.transformFailed, e.message);
    if (e instanceof AppError)
      return reject(REJECT_CODES.transformFailed, e.detail ?? e.code);
    throw e;
  }
}
