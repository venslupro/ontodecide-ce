/**
 * @fileoverview Pure state helpers of the data source wizard: mapping draft
 * (with AI suggestions that stay inert until confirmed), primary key guess,
 * name auto-matching, MappingSpec / QualityRule assembly and validation.
 */

import type {MappingSuggestion} from '@ontodecide/decision/contract';
import {
  INGEST_LIMITS,
  mappingSpecSchema,
  qualityRuleSchema,
  type ConflictPolicy,
  type MappingSpec,
  type QualityRule,
  type RestSourceConfig,
  type SourceKind,
  type TxnType,
} from '@ontodecide/integration/contract';
import type {UiObjectType} from '../../entities/schema/model';
import {qualityRuleProblem} from './preview';
import {validateChain} from './transform';

/** An AI suggestion attached to a mapping row. */
export interface AiSuggestion {
  to: string;
  transform: string;
  confidence: number;
  status: 'pending' | 'accepted';
}

/** One source field → target property row. */
export interface FieldRow {
  from: string;
  /** Target property ('' = not imported). Pending AI suggestions never set it. */
  to: string;
  transform: string;
  ai?: AiSuggestion;
}

/** One link row. */
export interface LinkRow {
  id: string;
  type: string;
  toKey: string;
  split: string;
  weightFrom: string;
}

/** Primary key row. */
export interface PrimaryKeyRow {
  from: string;
  transform: string;
  ai?: {from: string; transform: string; status: 'pending' | 'accepted'};
}

/** Mapping draft edited in step 3. */
export interface MappingDraft {
  primaryKey: PrimaryKeyRow;
  fields: FieldRow[];
  links: LinkRow[];
  sourceTsFrom: string;
}

/** Quality rule row edited in step 4 (arguments kept as text until built). */
export interface RuleRow {
  id: string;
  prop: string;
  kind: QualityRule['kind'];
  min: string;
  max: string;
  pattern: string;
  hours: string;
  refType: string;
  onFail: QualityRule['onFail'];
}

/** REST connector draft. */
export interface RestDraft {
  url: string;
  method: 'GET' | 'POST';
  itemsPath: string;
  cursorParam: string;
  cursorPath: string;
  headers: {id: string; key: string; value: string; secret: boolean}[];
}

/** Settings chosen in step 2. */
export interface SourceSettings {
  name: string;
  targetType: string;
  txnType: TxnType;
  conflictPolicy: ConflictPolicy;
}

/** Wizard kinds. */
export type WizardKind = SourceKind;

let idSeq = 0;
/** Local row id. */
export function rowId(prefix = 'r'): string {
  idSeq += 1;
  return `${prefix}${idSeq}`;
}

/** Normalizes a field / property name for fuzzy matching. */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.]/g, '');
}

/** Empty mapping draft for the given source fields. */
export function emptyDraft(
  fields: readonly string[],
  pkFrom = '',
): MappingDraft {
  return {
    primaryKey: {from: pkFrom, transform: 'trim'},
    fields: fields.map(from => ({from, to: '', transform: ''})),
    links: [],
    sourceTsFrom: '',
  };
}

/** Keeps existing rows for fields that still exist, adds new ones. */
export function syncDraftFields(
  draft: MappingDraft,
  fields: readonly string[],
): MappingDraft {
  const byFrom = new Map(draft.fields.map(r => [r.from, r]));
  return {
    ...draft,
    fields: fields.map(
      from => byFrom.get(from) ?? {from, to: '', transform: ''},
    ),
  };
}

/** Guesses the source field holding the target type's primary key. */
export function guessPrimaryKey(
  fields: readonly string[],
  type: Pick<UiObjectType, 'primaryKey' | 'apiName'> | undefined,
): string {
  if (fields.length === 0) return type?.primaryKey ?? '';
  if (!type) return fields[0];
  const exact = fields.find(f => f === type.primaryKey);
  if (exact) return exact;
  const n = normName(type.primaryKey);
  const fuzzy = fields.find(f => normName(f) === n);
  if (fuzzy) return fuzzy;
  const idLike = fields.find(f =>
    ['id', 'key', 'code', `${normName(type.apiName)}id`].includes(normName(f)),
  );
  return idLike ?? fields[0];
}

/** Maps rows whose name matches a property name or display name. */
export function autoMatch(
  draft: MappingDraft,
  type: UiObjectType,
): MappingDraft {
  const used = new Set(draft.fields.map(r => r.to).filter(Boolean));
  const fields = draft.fields.map(r => {
    if (r.to) return r;
    const n = normName(r.from);
    const prop = type.properties.find(
      p =>
        !used.has(p.apiName) &&
        (normName(p.apiName) === n || normName(p.displayName) === n),
    );
    if (!prop) return r;
    used.add(prop.apiName);
    return {
      ...r,
      to: prop.apiName,
      transform: r.transform || defaultTransform(prop.dataType),
    };
  });
  return {...draft, fields};
}

/** A sensible default transform for a data type. */
export function defaultTransform(dataType: string): string {
  if (dataType === 'double') return 'toNumber';
  if (dataType === 'integer') return 'toInteger';
  if (dataType === 'boolean') return 'toBoolean';
  if (dataType === 'date' || dataType === 'timestamp') return 'parseDate';
  return 'trim';
}

/**
 * Attaches an AI draft as pending suggestions. Nothing is applied: `to` /
 * `transform` stay as they were until the user confirms each row.
 */
export function applySuggestion(
  draft: MappingDraft,
  s: MappingSuggestion,
  type: UiObjectType | undefined,
): MappingDraft {
  const props = new Set(type?.properties.map(p => p.apiName) ?? []);
  const fields = [...draft.fields];
  for (const f of s.fields) {
    if (!f.from || !f.to || (type && !props.has(f.to))) continue;
    const idx = fields.findIndex(r => r.from === f.from);
    const ai: AiSuggestion = {
      to: f.to,
      transform: f.transform ?? '',
      confidence: Math.max(0, Math.min(1, Number(f.confidence) || 0)),
      status: 'pending',
    };
    if (idx >= 0) fields[idx] = {...fields[idx], ai};
    else fields.push({from: f.from, to: '', transform: '', ai});
  }
  const primaryKey: PrimaryKeyRow =
    s.primaryKey?.from && s.primaryKey.from !== draft.primaryKey.from
      ? {
          ...draft.primaryKey,
          ai: {
            from: s.primaryKey.from,
            transform: s.primaryKey.transform ?? 'trim',
            status: 'pending',
          },
        }
      : draft.primaryKey;
  return {...draft, fields, primaryKey};
}

/** Confirms the AI suggestion of one row (applies it). */
export function acceptAi(draft: MappingDraft, from: string): MappingDraft {
  return {
    ...draft,
    fields: draft.fields.map(r =>
      r.from === from && r.ai?.status === 'pending'
        ? {
            ...r,
            to: r.ai.to,
            transform: r.ai.transform,
            ai: {...r.ai, status: 'accepted'},
          }
        : r,
    ),
  };
}

/** Discards the AI suggestion of one row. */
export function dismissAi(draft: MappingDraft, from: string): MappingDraft {
  return {
    ...draft,
    fields: draft.fields.map(r =>
      r.from === from ? {...r, ai: undefined} : r,
    ),
  };
}

/** Confirms the AI primary key suggestion. */
export function acceptAiPrimaryKey(draft: MappingDraft): MappingDraft {
  const ai = draft.primaryKey.ai;
  if (!ai || ai.status !== 'pending') return draft;
  return {
    ...draft,
    primaryKey: {
      from: ai.from,
      transform: ai.transform,
      ai: {...ai, status: 'accepted'},
    },
  };
}

/** Discards the AI primary key suggestion. */
export function dismissAiPrimaryKey(draft: MappingDraft): MappingDraft {
  return {...draft, primaryKey: {...draft.primaryKey, ai: undefined}};
}

/** Confirms every pending suggestion. */
export function acceptAllAi(draft: MappingDraft): MappingDraft {
  let d = acceptAiPrimaryKey(draft);
  for (const r of d.fields)
    if (r.ai?.status === 'pending') d = acceptAi(d, r.from);
  return d;
}

/** Number of unconfirmed AI suggestions. */
export function pendingAiCount(draft: MappingDraft): number {
  return (
    draft.fields.filter(r => r.ai?.status === 'pending').length +
    (draft.primaryKey.ai?.status === 'pending' ? 1 : 0)
  );
}

/** Builds the MappingSpec from confirmed rows only. */
export function buildMapping(
  draft: MappingDraft,
  targetType: string,
  type?: UiObjectType,
): MappingSpec {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  const links = draft.links
    .filter(l => l.type && l.toKey)
    .map(l => {
      const lt = type?.links.find(x => x.apiName === l.type);
      return {
        type: l.type,
        toType: lt?.to ?? '',
        toKey: l.toKey,
        ...(opt(l.split) ? {split: l.split} : {}),
        ...(opt(l.weightFrom) ? {weightFrom: l.weightFrom} : {}),
      };
    });
  return {
    targetType,
    primaryKey: {
      from: draft.primaryKey.from,
      ...(opt(draft.primaryKey.transform)
        ? {transform: draft.primaryKey.transform.trim()}
        : {}),
    },
    fields: draft.fields
      .filter(r => r.to)
      .map(r => ({
        to: r.to,
        from: r.from,
        ...(opt(r.transform) ? {transform: r.transform.trim()} : {}),
      })),
    ...(links.length ? {links} : {}),
    ...(opt(draft.sourceTsFrom) ? {sourceTsFrom: draft.sourceTsFrom} : {}),
  };
}

/** Mapping problems (i18n keys + params). Blocking unless `warning`. */
export interface MappingIssue {
  key: string;
  params?: Record<string, string | number>;
  warning?: boolean;
}

/** Validates the mapping draft (schema + chains + duplicates + required props). */
export function mappingIssues(
  draft: MappingDraft,
  targetType: string,
  type: UiObjectType | undefined,
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const spec = buildMapping(draft, targetType, type);
  if (!draft.primaryKey.from) issues.push({key: 'mapping.issues.pkMissing'});
  const parsed = mappingSpecSchema.safeParse(spec);
  if (!parsed.success && draft.primaryKey.from)
    issues.push({
      key: 'mapping.issues.schema',
      params: {detail: parsed.error.issues[0]?.message ?? ''},
    });
  const chains = [
    {from: draft.primaryKey.from, transform: draft.primaryKey.transform},
    ...draft.fields.filter(r => r.to),
  ];
  for (const c of chains) {
    const err = validateChain(c.transform);
    if (err)
      issues.push({
        key: 'mapping.issues.chain',
        params: {field: c.from, detail: err.message},
      });
  }
  const seen = new Map<string, string>();
  for (const r of draft.fields.filter(x => x.to)) {
    const prev = seen.get(r.to);
    if (prev)
      issues.push({
        key: 'mapping.issues.duplicate',
        params: {prop: r.to, a: prev, b: r.from},
      });
    seen.set(r.to, r.from);
  }
  if (type) {
    const mapped = new Set([...seen.keys(), type.primaryKey]);
    const missing = type.properties
      .filter(p => p.required && !mapped.has(p.apiName))
      .map(p => p.displayName);
    if (missing.length)
      issues.push({
        key: 'mapping.issues.requiredMissing',
        params: {props: missing.join(', ')},
        warning: true,
      });
  }
  for (const l of draft.links) {
    if (!l.type || !l.toKey)
      issues.push({key: 'mapping.issues.linkIncomplete'});
  }
  const pending = pendingAiCount(draft);
  if (pending)
    issues.push({
      key: 'mapping.issues.aiPending',
      params: {count: pending},
      warning: true,
    });
  return issues;
}

/** New empty rule row. */
export function newRule(prop = ''): RuleRow {
  return {
    id: rowId('q'),
    prop,
    kind: 'required',
    min: '',
    max: '',
    pattern: '',
    hours: '24',
    refType: '',
    onFail: 'reject',
  };
}

/** Builds a QualityRule from a row. */
export function buildRule(r: RuleRow): QualityRule {
  const base = {prop: r.prop, kind: r.kind, onFail: r.onFail};
  switch (r.kind) {
    case 'range':
      return {
        ...base,
        arg: [
          r.min.trim() === '' ? NaN : Number(r.min),
          r.max.trim() === '' ? NaN : Number(r.max),
        ],
      };
    case 'format':
      return {...base, arg: r.pattern};
    case 'freshness':
      return {...base, arg: r.hours.trim() === '' ? NaN : Number(r.hours)};
    case 'ref':
      return r.refType ? {...base, arg: r.refType} : base;
    default:
      return base;
  }
}

/** Rule row from a stored rule. */
export function ruleRowFrom(q: QualityRule): RuleRow {
  const r = newRule(q.prop);
  r.kind = q.kind;
  r.onFail = q.onFail;
  if (q.kind === 'range' && Array.isArray(q.arg)) {
    r.min = String(q.arg[0] ?? '');
    r.max = String(q.arg[1] ?? '');
  }
  if (q.kind === 'format' && typeof q.arg === 'string') r.pattern = q.arg;
  if (q.kind === 'freshness' && typeof q.arg === 'number')
    r.hours = String(q.arg);
  if (q.kind === 'ref' && typeof q.arg === 'string') r.refType = q.arg;
  return r;
}

/** Problem key of a rule row (null when valid). */
export function ruleIssue(r: RuleRow): string | null {
  if (!r.prop) return 'quality.issues.prop';
  const q = buildRule(r);
  if (!qualityRuleSchema.safeParse(q).success) return 'quality.issues.schema';
  const p = qualityRuleProblem(q);
  return p ? `quality.issues.${p}` : null;
}

/** Empty REST draft. */
export function emptyRest(): RestDraft {
  return {
    url: '',
    method: 'GET',
    itemsPath: '$.data',
    cursorParam: '',
    cursorPath: '',
    headers: [],
  };
}

/** Builds the REST connector config (secret headers stored encrypted server-side). */
export function buildRestConfig(d: RestDraft): RestSourceConfig {
  const headers: Record<string, string> = {};
  const secretHeaders: Record<string, string> = {};
  for (const h of d.headers) {
    if (!h.key.trim()) continue;
    (h.secret ? secretHeaders : headers)[h.key.trim()] = h.value;
  }
  return {
    url: d.url.trim(),
    method: d.method,
    itemsPath: d.itemsPath.trim(),
    ...(Object.keys(headers).length ? {headers} : {}),
    ...(Object.keys(secretHeaders).length ? {secretHeaders} : {}),
    ...(d.cursorParam.trim() ? {cursorParam: d.cursorParam.trim()} : {}),
    ...(d.cursorPath.trim() ? {cursorPath: d.cursorPath.trim()} : {}),
    pageLimit: INGEST_LIMITS.restPageLimitMax,
  };
}

/** Mirrors the server JSONPath subset: `$`, `.key`, `[*]`, `[0]`, `['key']`. */
export function isJsonPath(path: string): boolean {
  return /^\$(?:\.[A-Za-z0-9_$-]+|\[\s*(?:\*|\d+|'[^']*'|"[^"]*")\s*\])*$/.test(
    path.trim(),
  );
}

/** Whether the REST draft is complete enough to create the source. */
export function restIssues(d: RestDraft): string[] {
  const out: string[] = [];
  try {
    const u = new URL(d.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
      out.push('rest.issues.url');
  } catch {
    out.push('rest.issues.url');
  }
  if (!isJsonPath(d.itemsPath)) out.push('rest.issues.itemsPath');
  return out;
}

/** First ≤ n rows as arrays in field order (AI mapping sample). */
export function sampleArrays(
  fields: readonly string[],
  rows: readonly Record<string, unknown>[],
  n = 20,
): unknown[][] {
  return rows.slice(0, n).map(r => fields.map(f => r[f] ?? ''));
}

/** Distinct non-empty sample values of a field. */
export function sampleValues(
  rows: readonly Record<string, unknown>[],
  field: string,
  n = 3,
): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const v = r[field];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (!out.includes(s)) out.push(s);
    if (out.length >= n) break;
  }
  return out;
}
