/**
 * @fileoverview Record-level quality rules: required, range, format,
 * freshness and ref. `onFail` decides whether a failure rejects the record,
 * clamps the value (range only) or is deferred (accepted with a warning).
 */

import {AppError} from '@ontodecide/shared-kernel';
import type {QualityRule} from '../contract';

/** Rejection code for a failed quality rule. */
export const QUALITY_FAILED = 'QUALITY_FAILED';

/** Input to {@link applyQualityRules}. */
export interface QualityInput {
  /** Mapped and coerced properties (may be modified by clamp). */
  props: Record<string, unknown>;
  /** The raw source record (fallback lookup for non-mapped fields). */
  record: Record<string, unknown>;
  /** ISO source timestamp, when the mapping defines `sourceTsFrom`. */
  sourceTs?: string;
  now: Date;
}

/** Outcome of evaluating the rules of one record. */
export type QualityOutcome =
  | {ok: true; props: Record<string, unknown>; warnings: string[]}
  | {ok: false; code: string; detail: string};

function isBlank(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0)
  );
}

function lookup(input: QualityInput, prop: string): unknown {
  return Object.prototype.hasOwnProperty.call(input.props, prop)
    ? input.props[prop]
    : input.record[prop];
}

function rangeArg(rule: QualityRule): [number, number] {
  const a = rule.arg;
  if (
    !Array.isArray(a) ||
    a.length !== 2 ||
    typeof a[0] !== 'number' ||
    typeof a[1] !== 'number' ||
    a[0] > a[1]
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      `range rule on ${rule.prop} needs [min,max]`,
    );
  }
  return [a[0], a[1]];
}

const REGEX_CACHE = new Map<string, RegExp>();

function formatArg(rule: QualityRule): RegExp {
  if (typeof rule.arg !== 'string' || rule.arg === '') {
    throw new AppError(
      'VALIDATION_FAILED',
      `format rule on ${rule.prop} needs a regex`,
    );
  }
  let re = REGEX_CACHE.get(rule.arg);
  if (!re) {
    try {
      re = new RegExp(rule.arg);
    } catch {
      throw new AppError('VALIDATION_FAILED', `Invalid regex for ${rule.prop}`);
    }
    REGEX_CACHE.set(rule.arg, re);
  }
  return re;
}

function freshnessArg(rule: QualityRule): number {
  const h = rule.arg;
  if (typeof h !== 'number' || !(h > 0)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `freshness rule on ${rule.prop} needs max age hours > 0`,
    );
  }
  return h;
}

/** Validates rule definitions (at source create/update). */
export function validateQualityRules(rules: readonly QualityRule[]): void {
  for (const r of rules) {
    if (r.onFail === 'clamp' && r.kind !== 'range') {
      throw new AppError(
        'VALIDATION_FAILED',
        `onFail=clamp only applies to range rules (${r.prop})`,
      );
    }
    if (r.kind === 'range') rangeArg(r);
    if (r.kind === 'format') formatArg(r);
    if (r.kind === 'freshness') freshnessArg(r);
  }
}

/** Evaluates one rule; returns a failure message or null. */
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
      const [min, max] = rangeArg(rule);
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
    case 'format': {
      if (isBlank(v)) return null;
      return formatArg(rule).test(String(v))
        ? null
        : {detail: `${rule.prop} does not match format`};
    }
    case 'freshness': {
      const hours = freshnessArg(rule);
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

/**
 * Applies quality rules in order. The first `reject` failure rejects the
 * record; `clamp` rewrites the property; `defer` adds a warning.
 */
export function applyQualityRules(
  rules: readonly QualityRule[],
  input: QualityInput,
): QualityOutcome {
  const props = {...input.props};
  const warnings: string[] = [];
  const view: QualityInput = {...input, props};
  for (const rule of rules) {
    const failure = check(rule, view);
    if (!failure) continue;
    if (rule.onFail === 'reject') {
      return {
        ok: false,
        code: QUALITY_FAILED,
        detail: `${rule.kind}: ${failure.detail}`,
      };
    }
    if (rule.onFail === 'clamp' && failure.clampTo !== undefined) {
      props[rule.prop] = failure.clampTo;
      continue;
    }
    warnings.push(`${rule.kind}: ${failure.detail}`);
  }
  return {ok: true, props, warnings};
}
