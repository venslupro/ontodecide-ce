/**
 * @fileoverview Client-side mirror of the server mapping engine and quality
 * rules (`packages/integration/domain/{mapping,quality}.ts`): maps parsed
 * rows with the current mapping + transform chains, coerces them with the
 * shared `validateProps` and applies quality rules, so the wizard can show
 * transformed rows and validation stats before anything is uploaded.
 */

import type {MappingSpec, QualityRule} from '@ontodecide/integration/contract';
import {
  validateProps,
  type CompiledObjectType,
} from '@ontodecide/ontology/contract';
import {ChainSyntaxError, compileChain, TransformError} from './transform';

/** Rejection codes (same strings as the server). */
export const REJECT_CODES = {
  primaryKeyMissing: 'PRIMARY_KEY_MISSING',
  transformFailed: 'TRANSFORM_FAILED',
  propInvalid: 'PROP_INVALID',
  qualityFailed: 'QUALITY_FAILED',
} as const;

/** Outcome of mapping one row. */
export type RowPreview =
  | {
      ok: true;
      row: number;
      primaryKey: string;
      props: Record<string, unknown>;
      links: {type: string; toType: string; toKey: string; weight?: number}[];
      warnings: string[];
      /** Properties rewritten by an `onFail: clamp` rule. */
      clamped: string[];
    }
  | {ok: false; row: number; code: string; detail: string};

function isBlank(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0)
  );
}

/** Validation problem of one quality rule definition (null when valid). */
export function qualityRuleProblem(
  r: QualityRule,
):
  | 'CLAMP_NOT_RANGE'
  | 'RANGE_ARG'
  | 'FORMAT_ARG'
  | 'FRESHNESS_ARG'
  | 'REF_ARG'
  | null {
  if (r.onFail === 'clamp' && r.kind !== 'range') return 'CLAMP_NOT_RANGE';
  if (r.kind === 'range') {
    const a = r.arg;
    if (
      !Array.isArray(a) ||
      a.length !== 2 ||
      typeof a[0] !== 'number' ||
      typeof a[1] !== 'number' ||
      a[0] > a[1]
    ) {
      return 'RANGE_ARG';
    }
  }
  if (r.kind === 'format') {
    if (typeof r.arg !== 'string' || r.arg === '') return 'FORMAT_ARG';
    try {
      new RegExp(r.arg);
    } catch {
      return 'FORMAT_ARG';
    }
  }
  if (r.kind === 'freshness' && !(typeof r.arg === 'number' && r.arg > 0))
    return 'FRESHNESS_ARG';
  if (
    r.kind === 'ref' &&
    r.arg !== undefined &&
    (typeof r.arg !== 'string' || r.arg === '')
  )
    return 'REF_ARG';
  return null;
}

interface QualityInput {
  props: Record<string, unknown>;
  record: Record<string, unknown>;
  sourceTs?: string;
  now: Date;
}

function lookup(input: QualityInput, prop: string): unknown {
  return Object.prototype.hasOwnProperty.call(input.props, prop)
    ? input.props[prop]
    : input.record[prop];
}

function check(
  rule: QualityRule,
  input: QualityInput,
): {detail: string; clampTo?: number} | null {
  const v = lookup(input, rule.prop);
  switch (rule.kind) {
    case 'required':
      return isBlank(v) ? {detail: `${rule.prop} is required`} : null;
    case 'ref':
      return isBlank(v)
        ? {detail: `${rule.prop} reference key is empty`}
        : null;
    case 'range': {
      if (isBlank(v)) return null;
      const [min, max] = rule.arg as [number, number];
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return {detail: `${rule.prop} is not numeric`};
      if (n < min || n > max) {
        return {
          detail: `${rule.prop} out of range [${min},${max}]`,
          clampTo: Math.min(max, Math.max(min, n)),
        };
      }
      return null;
    }
    case 'format':
      if (isBlank(v)) return null;
      return new RegExp(rule.arg as string).test(String(v))
        ? null
        : {detail: `${rule.prop} does not match format`};
    case 'freshness': {
      const hours = rule.arg as number;
      const ts = !isBlank(v) ? v : input.sourceTs;
      if (isBlank(ts)) return {detail: `${rule.prop} has no timestamp`};
      const t = new Date(ts as string | number).getTime();
      if (Number.isNaN(t)) return {detail: `${rule.prop} is not a timestamp`};
      const ageH = (input.now.getTime() - t) / 3_600_000;
      return ageH > hours
        ? {detail: `${rule.prop} older than ${hours}h`}
        : null;
    }
    default:
      return null;
  }
}

/** Applies quality rules in order (first `reject` failure wins). */
export function applyQualityRules(
  rules: readonly QualityRule[],
  input: QualityInput,
):
  | {
      ok: true;
      props: Record<string, unknown>;
      warnings: string[];
      clamped: string[];
    }
  | {ok: false; code: string; detail: string} {
  const props = {...input.props};
  const warnings: string[] = [];
  const clamped: string[] = [];
  const view: QualityInput = {...input, props};
  for (const rule of rules) {
    if (qualityRuleProblem(rule)) continue; // invalid rules are flagged in the editor
    const failure = check(rule, view);
    if (!failure) continue;
    if (rule.onFail === 'reject')
      return {
        ok: false,
        code: REJECT_CODES.qualityFailed,
        detail: `${rule.kind}: ${failure.detail}`,
      };
    if (rule.onFail === 'clamp' && failure.clampTo !== undefined) {
      props[rule.prop] = failure.clampTo;
      clamped.push(rule.prop);
      continue;
    }
    warnings.push(`${rule.kind}: ${failure.detail}`);
  }
  return {ok: true, props, warnings, clamped};
}

function toIso(v: unknown): string | undefined {
  if (isBlank(v)) return undefined;
  const raw = typeof v === 'number' && v < 1e11 ? v * 1000 : v;
  const d = new Date(raw as string | number);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function linkKeys(value: unknown, split?: string): string[] {
  if (isBlank(value)) return [];
  const parts = Array.isArray(value)
    ? value.map(String)
    : split
      ? String(value).split(split)
      : [String(value)];
  return parts.map(s => s.trim()).filter(s => s !== '');
}

/** Maps one record (1-based `row`) exactly like the server would. */
export function previewRow(
  record: Record<string, unknown>,
  row: number,
  ctx: {
    mapping: MappingSpec;
    rules: readonly QualityRule[];
    targetType: CompiledObjectType;
    now: Date;
  },
): RowPreview {
  const {mapping, targetType} = ctx;
  const reject = (code: string, detail: string): RowPreview => ({
    ok: false,
    row,
    code,
    detail,
  });
  try {
    const pkValue = compileChain(mapping.primaryKey.transform).apply(
      record[mapping.primaryKey.from],
    );
    if (isBlank(pkValue) || typeof pkValue === 'object') {
      return reject(
        REJECT_CODES.primaryKeyMissing,
        `${mapping.primaryKey.from} is empty`,
      );
    }
    const primaryKey = String(pkValue).trim();
    const input: Record<string, unknown> = {};
    for (const f of mapping.fields)
      input[f.to] = compileChain(f.transform).apply(record[f.from]);
    if (isBlank(input[targetType.primaryKey]))
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
    const quality = applyQualityRules(ctx.rules, {
      props,
      record,
      sourceTs,
      now: ctx.now,
    });
    if (!quality.ok) return reject(quality.code, quality.detail);
    const links: {
      type: string;
      toType: string;
      toKey: string;
      weight?: number;
    }[] = [];
    for (const l of mapping.links ?? []) {
      const weightRaw = l.weightFrom ? record[l.weightFrom] : undefined;
      let weight: number | undefined;
      if (!isBlank(weightRaw)) {
        const n =
          typeof weightRaw === 'number'
            ? weightRaw
            : Number(String(weightRaw).trim());
        if (!Number.isFinite(n))
          return reject(
            REJECT_CODES.transformFailed,
            `${l.weightFrom}: weight is not a number`,
          );
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
    return {
      ok: true,
      row,
      primaryKey,
      props: quality.props,
      links,
      warnings: quality.warnings,
      clamped: quality.clamped,
    };
  } catch (e) {
    if (e instanceof TransformError)
      return reject(REJECT_CODES.transformFailed, e.message);
    if (e instanceof ChainSyntaxError)
      return reject(REJECT_CODES.transformFailed, e.message);
    throw e;
  }
}

/** Aggregated validation stats over all parsed rows. */
export interface PreviewStats {
  total: number;
  valid: number;
  rejected: number;
  clamped: number;
  warned: number;
  /** Rejection reasons, most frequent first. */
  reasons: {code: string; detail: string; count: number; example: number}[];
}

/** Maps every row and aggregates the outcome. */
export function previewStats(
  rows: readonly Record<string, unknown>[],
  ctx: {
    mapping: MappingSpec;
    rules: readonly QualityRule[];
    targetType: CompiledObjectType;
    now: Date;
  },
): PreviewStats {
  const stats: PreviewStats = {
    total: rows.length,
    valid: 0,
    rejected: 0,
    clamped: 0,
    warned: 0,
    reasons: [],
  };
  const reasons = new Map<
    string,
    {code: string; detail: string; count: number; example: number}
  >();
  rows.forEach((r, i) => {
    const res = previewRow(r, i + 1, ctx);
    if (!res.ok) {
      stats.rejected++;
      // Group by code + the part of the detail without row-specific values.
      const key = `${res.code}|${res.detail}`;
      const cur = reasons.get(key);
      if (cur) cur.count++;
      else
        reasons.set(key, {
          code: res.code,
          detail: res.detail,
          count: 1,
          example: res.row,
        });
      return;
    }
    stats.valid++;
    if (res.clamped.length > 0) stats.clamped++;
    if (res.warnings.length > 0) stats.warned++;
  });
  stats.reasons = [...reasons.values()].sort((a, b) => b.count - a.count);
  return stats;
}
