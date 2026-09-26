/**
 * @fileoverview AI mapping suggestion support: LLM output schema and
 * whitelist validation, prompt, and the heuristic fallback based on
 * normalized name similarity.
 */

import {z} from 'zod';
import type {MappingSuggestion, TargetProp} from '../contract';
import {extractJson, RULE_MODEL} from './advice';
import type {Prompt} from './prompts';

/** Sample handed to the mapping suggester. */
export interface MappingSample {
  fields: string[];
  rows: unknown[][];
  targetType: string;
  targetProps: TargetProp[];
}

/** LLM output schema for mapping suggestions. */
export const MappingOutputSchema = z.object({
  primaryKey: z.object({from: z.string(), transform: z.string().optional()}),
  fields: z
    .array(
      z.object({
        to: z.string(),
        from: z.string(),
        transform: z.string().optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(200),
});

/** Normalizes a field or property name for comparison. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function bigrams(s: string): string[] {
  if (s.length < 2) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Similarity of two names in 0..1 (exact, containment, Dice bigrams). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (long.includes(short)) return 0.6 + 0.35 * (short.length / long.length);
  const bx = bigrams(x);
  const by = bigrams(y);
  const pool = new Map<string, number>();
  for (const g of by) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of bx) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      hits++;
      pool.set(g, n - 1);
    }
  }
  return (2 * hits) / (bx.length + by.length);
}

/** Minimum similarity for the heuristic to propose a field. */
export const MAPPING_MIN_CONFIDENCE = 0.5;

function score(field: string, prop: TargetProp): number {
  return Math.max(
    nameSimilarity(field, prop.apiName),
    prop.displayName ? nameSimilarity(field, prop.displayName) : 0,
  );
}

/** Heuristic mapping: greedy best-first assignment by name similarity. */
export function heuristicMapping(sample: MappingSample): MappingSuggestion {
  const pairs: {field: string; prop: TargetProp; s: number}[] = [];
  for (const prop of sample.targetProps) {
    for (const field of sample.fields) {
      const s = score(field, prop);
      if (s >= MAPPING_MIN_CONFIDENCE) pairs.push({field, prop, s});
    }
  }
  pairs.sort((a, b) => b.s - a.s);
  const usedFields = new Set<string>();
  const usedProps = new Set<string>();
  const fields: MappingSuggestion['fields'] = [];
  for (const p of pairs) {
    if (usedFields.has(p.field) || usedProps.has(p.prop.apiName)) continue;
    usedFields.add(p.field);
    usedProps.add(p.prop.apiName);
    fields.push({
      to: p.prop.apiName,
      from: p.field,
      confidence: Math.round(p.s * 100) / 100,
    });
  }
  const order = new Map(sample.targetProps.map((p, i) => [p.apiName, i]));
  fields.sort((a, b) => (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0));
  const first = sample.targetProps[0];
  let pkFrom = first
    ? fields.find(f => f.to === first.apiName)?.from
    : undefined;
  if (!pkFrom && first) {
    pkFrom = [...sample.fields].sort(
      (a, b) => score(b, first) - score(a, first),
    )[0];
    if (pkFrom && score(pkFrom, first) === 0) pkFrom = undefined;
  }
  pkFrom ??= sample.fields.find(f => /id/i.test(f)) ?? sample.fields[0] ?? '';
  return {
    targetType: sample.targetType,
    primaryKey: {from: pkFrom},
    fields,
    model: RULE_MODEL,
  };
}

/** Builds the mapping prompt (fields, ≤ 20 rows, target properties). */
export function buildMappingPrompt(sample: MappingSample): Prompt {
  return {
    system: [
      'You map columns of a tabular data source onto properties of an ontology object type.',
      'Reply with a single JSON object only: {"primaryKey": {"from": string, "transform"?: string}, "fields": [{"to": string, "from": string, "transform"?: string, "confidence": number 0..1}]}.',
      '"from" must be one of FIELDS; "to" must be one of TARGET_PROPS.apiName. Omit properties you cannot map.',
    ].join('\n'),
    user: [
      `TARGET_TYPE: ${sample.targetType}`,
      `TARGET_PROPS: ${JSON.stringify(sample.targetProps)}`,
      `FIELDS: ${JSON.stringify(sample.fields)}`,
      `ROWS: ${JSON.stringify(sample.rows.slice(0, 20))}`,
    ].join('\n'),
  };
}

/** Validates LLM mapping output against the whitelist. */
export function validateMapping(
  text: string,
  sample: MappingSample,
  model: string,
): {ok: true; value: MappingSuggestion} | {ok: false; error: string} {
  const json = extractJson(text);
  const parsed = MappingOutputSchema.safeParse(json);
  if (!parsed.success) return {ok: false, error: 'Schema mismatch'};
  const fieldSet = new Set(sample.fields);
  const propSet = new Set(sample.targetProps.map(p => p.apiName));
  if (!fieldSet.has(parsed.data.primaryKey.from)) {
    return {ok: false, error: 'Unknown primary key field'};
  }
  const seen = new Set<string>();
  for (const f of parsed.data.fields) {
    if (!fieldSet.has(f.from) || !propSet.has(f.to)) {
      return {ok: false, error: `Unknown field mapping ${f.from} → ${f.to}`};
    }
    if (seen.has(f.to)) return {ok: false, error: `Duplicate target ${f.to}`};
    seen.add(f.to);
  }
  return {
    ok: true,
    value: {
      targetType: sample.targetType,
      primaryKey: parsed.data.primaryKey,
      fields: parsed.data.fields,
      model,
    },
  };
}
