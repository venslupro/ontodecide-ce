/**
 * @fileoverview Mapping model of the import wizard (字段映射): one row per
 * source column with its target (a property of the target type, or a link
 * type whose cell holds the target keys), transform chain and status
 * (已确认 / 确定性匹配 / AI 建议 / 待确认). Includes the deterministic
 * auto-match (same name, synonyms, similarity — mirroring the server's
 * rule draft), merging an AI mapping draft, the Next-button checks and the
 * conversion to the contract {@link MappingSpec}.
 */

import type {
  MappingDraft,
  MappingSpec,
  MatchedBy,
} from '@ontodecide/integration/contract';
import type {
  UiLinkType,
  UiModel,
  UiObjectType,
  UiProperty,
} from '../../entities/schema/model';
import type {SourceRow} from '../../workers/parse_core';
import {validateChain} from './transform';

/** Target of a source column. */
export type MappingTarget =
  | {kind: 'prop'; prop: string}
  | {kind: 'link'; linkType: string; toType: string};

/** One source column of the mapping table. */
export interface FieldMapping {
  source: string;
  target: MappingTarget | null;
  /** Transform chain of a property target. */
  transform: string;
  /** Separator of multi-valued link cells. */
  split: string;
  matchedBy?: MatchedBy;
  /** Explicitly confirmed (or set manually) by the user. */
  confirmed: boolean;
}

/** Display status of a mapping row. */
export type FieldStatus = 'confirmed' | 'deterministic' | 'ai' | 'pending';

/** Status of a row (AI suggestions need an explicit confirmation). */
export function fieldStatus(m: FieldMapping): FieldStatus {
  if (m.target && m.confirmed) return 'confirmed';
  if (m.target && m.matchedBy === 'ai') return 'ai';
  if (
    m.target &&
    (m.matchedBy === 'exact' ||
      m.matchedBy === 'synonym' ||
      m.matchedBy === 'similarity')
  ) {
    return 'deterministic';
  }
  return 'pending';
}

/** Normalizes a name: lower case without separators and punctuation. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s_\-.:/\\()[\]（）【】#·]+/g, '');
}

/** Synonyms by normalized property name (subset of the server table). */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  id: ['code', 'key', 'no', 'number', '编号', '编码', '代码'],
  name: [
    'title',
    'fullname',
    'displayname',
    'label',
    'suppliername',
    'vendorname',
    'materialname',
    'partname',
    'productname',
    '名称',
    '名字',
    '供应商名称',
    '物料名称',
  ],
  supplierid: [
    'supplier',
    'suppliercode',
    'supplierno',
    'vendor',
    'vendorid',
    'vendorcode',
    'vendorno',
    '供应商',
    '供应商编号',
    '供应商编码',
  ],
  sku: [
    'material',
    'materialid',
    'materialcode',
    'partno',
    'itemcode',
    '物料',
    '料号',
  ],
  country: [
    'nation',
    'countrycode',
    'origin',
    'region',
    '国家',
    '国别',
    '产地',
  ],
  riskscore: [
    'risk',
    'riskrating',
    'risklevel',
    'riskindex',
    '风险',
    '风险评分',
  ],
  capacityperweek: ['capacity', 'capwk', 'weeklycapacity', '产能', '周产能'],
  ontimerate: [
    'ontime',
    'otd',
    'otif',
    'ontimedelivery',
    '准时率',
    '准时交付率',
  ],
  status: ['state', 'supplierstatus', '状态'],
  onhand: ['stock', 'inventory', 'qty', 'quantity', '库存', '现有库存'],
  safetystock: ['minstock', 'reorderpoint', '安全库存'],
};

/** Minimum similarity for a `similarity` match (same as the server). */
export const SIMILARITY_THRESHOLD = 0.85;

/** Jaro-Winkler similarity of two strings (0..1). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      m++;
      break;
    }
  }
  if (m === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Similarity used for matching: Jaro-Winkler or containment. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const contained = short.length >= 4 && long.includes(short) ? 0.9 : 0;
  return Math.max(jaroWinkler(x, y), contained);
}

/** Suggested transform chain for a property's data type. */
export function transformFor(p: Pick<UiProperty, 'dataType'>): string {
  switch (p.dataType) {
    case 'double':
      return 'trim|toNumber';
    case 'integer':
      return 'trim|toInteger';
    case 'boolean':
      return 'toBoolean';
    case 'date':
    case 'timestamp':
      return 'parseDate';
    default:
      return 'trim';
  }
}

interface Candidate {
  field: string;
  prop: string;
  by: MatchedBy;
  score: number;
}

function scoreOf(field: string, p: UiProperty): Candidate | null {
  const f = normalizeName(field);
  if (!f) return null;
  if (f === normalizeName(p.apiName)) {
    return {field, prop: p.apiName, by: 'exact', score: 3};
  }
  const syn = new Set(
    [...(SYNONYMS[normalizeName(p.apiName)] ?? []), p.displayName].map(
      normalizeName,
    ),
  );
  if (syn.has(f)) return {field, prop: p.apiName, by: 'synonym', score: 2};
  const sim = Math.max(
    nameSimilarity(field, p.apiName),
    nameSimilarity(field, p.displayName),
  );
  return sim >= SIMILARITY_THRESHOLD
    ? {field, prop: p.apiName, by: 'similarity', score: 1 + sim}
    : null;
}

/** Link types starting at `type`. */
export function outgoingLinks(model: UiModel, type: string): UiLinkType[] {
  return model.links.filter(l => l.from === type);
}

function detectSplit(values: readonly unknown[]): string {
  const texts = values.filter((v): v is string => typeof v === 'string');
  for (const sep of [';', '|', ',', '、']) {
    if (texts.some(t => t.includes(sep))) return sep;
  }
  return ',';
}

function linkNames(model: UiModel, toType: string): Set<string> {
  const target = model.byName[toType];
  const names = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    const n = normalizeName(s);
    names.add(n);
    names.add(`${n}s`);
    names.add(`${n}list`);
    names.add(`${n}ids`);
  };
  add(toType);
  add(target?.primaryKey);
  add(target?.displayName);
  return names;
}

/**
 * Deterministic auto-match of every source column: properties by exact
 * name, synonym, then similarity (each property at most once, best score
 * first); remaining columns named after a linked type (e.g. `sku_list` for
 * `supplies → Material`) become pending link rows.
 */
export function autoMatch(
  fields: readonly string[],
  type: UiObjectType,
  model: UiModel,
  samples: readonly SourceRow[] = [],
): FieldMapping[] {
  const cands: Candidate[] = [];
  for (const f of fields) {
    for (const p of type.properties) {
      const c = scoreOf(f, p);
      if (c) cands.push(c);
    }
  }
  cands.sort(
    (a, b) =>
      b.score - a.score ||
      fields.indexOf(a.field) - fields.indexOf(b.field) ||
      a.prop.localeCompare(b.prop),
  );
  const byField = new Map<string, Candidate>();
  const usedProps = new Set<string>();
  for (const c of cands) {
    if (byField.has(c.field) || usedProps.has(c.prop)) continue;
    byField.set(c.field, c);
    usedProps.add(c.prop);
  }
  const usedLinks = new Set<string>();
  return fields.map(source => {
    const c = byField.get(source);
    if (c) {
      const p = type.properties.find(x => x.apiName === c.prop)!;
      return {
        source,
        target: {kind: 'prop', prop: c.prop},
        transform: transformFor(p),
        split: ',',
        matchedBy: c.by,
        confirmed: false,
      };
    }
    const f = normalizeName(source);
    const link = outgoingLinks(model, type.apiName).find(
      l => !usedLinks.has(l.apiName) && linkNames(model, l.to).has(f),
    );
    if (link) {
      usedLinks.add(link.apiName);
      return {
        source,
        target: {kind: 'link', linkType: link.apiName, toType: link.to},
        transform: '',
        split: detectSplit(samples.map(r => r[source])),
        confirmed: false,
      };
    }
    return {source, target: null, transform: '', split: ',', confirmed: false};
  });
}

/**
 * Merges an AI mapping draft into the rows. Rows the user already
 * confirmed are kept, as are local deterministic matches the draft agrees
 * with; draft fields keep their `matchedBy` (exact / synonym
 * / similarity → 确定性匹配, ai → AI 建议, which needs confirmation).
 */
export function applyDraft(
  rows: readonly FieldMapping[],
  draft: MappingDraft,
  type: UiObjectType,
  model: UiModel,
): FieldMapping[] {
  const next = rows.map(r => ({...r}));
  const bySource = new Map(next.map(r => [r.source, r] as const));
  const taken = (prop: string, except: string) =>
    next.some(
      r =>
        r.source !== except &&
        r.target?.kind === 'prop' &&
        r.target.prop === prop,
    );
  for (const f of draft.fields) {
    const row = bySource.get(f.from);
    const p = type.properties.find(x => x.apiName === f.to);
    if (!row || !p || row.confirmed) continue;
    if (taken(f.to, f.from)) continue;
    const same = row.target?.kind === 'prop' && row.target.prop === f.to;
    if (same && row.matchedBy && row.matchedBy !== 'ai') continue;
    row.target = {kind: 'prop', prop: f.to};
    row.transform = f.transform ?? transformFor(p);
    row.matchedBy = f.matchedBy ?? 'ai';
  }
  if (draft.primaryKey.from) {
    const row = bySource.get(draft.primaryKey.from);
    if (
      row &&
      !row.confirmed &&
      !row.target &&
      !taken(type.primaryKey, row.source)
    ) {
      row.target = {kind: 'prop', prop: type.primaryKey};
      row.transform = draft.primaryKey.transform ?? 'trim';
      row.matchedBy = row.matchedBy ?? 'ai';
    }
  }
  for (const l of draft.links ?? []) {
    const row = bySource.get(l.toKey);
    if (!row || row.confirmed || row.target?.kind === 'prop') continue;
    if (!model.linksByName[l.type]) continue;
    row.target = {kind: 'link', linkType: l.type, toType: l.toType};
    row.split = l.split ?? row.split;
    row.transform = '';
  }
  return next;
}

/** Confirms one row (a manual change also counts as confirmation). */
export function confirmRow(m: FieldMapping): FieldMapping {
  return {...m, confirmed: !!m.target};
}

/** Dismisses a suggestion: the column is left unmapped. */
export function dismissRow(m: FieldMapping): FieldMapping {
  return {...m, target: null, matchedBy: undefined, confirmed: false};
}

/** Sets a target manually. */
export function setTarget(
  m: FieldMapping,
  target: MappingTarget | null,
  type: UiObjectType,
): FieldMapping {
  if (!target) return dismissRow(m);
  const p =
    target.kind === 'prop'
      ? type.properties.find(x => x.apiName === target.prop)
      : undefined;
  return {
    ...m,
    target,
    transform: target.kind === 'prop' ? (p ? transformFor(p) : 'trim') : '',
    matchedBy: 'manual',
    confirmed: true,
  };
}

/** Encodes a target as a select value. */
export function targetValue(t: MappingTarget | null): string {
  if (!t) return '';
  return t.kind === 'prop' ? `prop:${t.prop}` : `link:${t.linkType}`;
}

/** Decodes a select value. */
export function parseTargetValue(
  value: string,
  model: UiModel,
): MappingTarget | null {
  if (value.startsWith('prop:')) return {kind: 'prop', prop: value.slice(5)};
  if (value.startsWith('link:')) {
    const l = model.linksByName[value.slice(5)];
    return l ? {kind: 'link', linkType: l.apiName, toType: l.to} : null;
  }
  return null;
}

/** A reason why the mapping cannot be used yet. */
export type MappingProblem =
  | {code: 'PRIMARY_KEY_UNMAPPED'; prop: string}
  | {code: 'REQUIRED_UNMAPPED'; prop: string}
  | {code: 'DUPLICATE_TARGET'; prop: string}
  | {code: 'CHAIN_INVALID'; source: string}
  | {code: 'AI_UNCONFIRMED'; count: number};

/** Checks that gate the Next button of the mapping step. */
export function mappingProblems(
  rows: readonly FieldMapping[],
  type: UiObjectType,
): MappingProblem[] {
  const out: MappingProblem[] = [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.target?.kind !== 'prop') continue;
    counts.set(r.target.prop, (counts.get(r.target.prop) ?? 0) + 1);
    if (validateChain(r.transform)) {
      out.push({code: 'CHAIN_INVALID', source: r.source});
    }
  }
  if (!counts.has(type.primaryKey)) {
    out.push({code: 'PRIMARY_KEY_UNMAPPED', prop: type.primaryKey});
  }
  for (const p of type.properties) {
    if (p.required && p.apiName !== type.primaryKey && !counts.has(p.apiName)) {
      out.push({code: 'REQUIRED_UNMAPPED', prop: p.apiName});
    }
  }
  for (const [prop, n] of counts) {
    if (n > 1) out.push({code: 'DUPLICATE_TARGET', prop});
  }
  const ai = rows.filter(r => fieldStatus(r) === 'ai').length;
  if (ai > 0) out.push({code: 'AI_UNCONFIRMED', count: ai});
  return out;
}

/** Builds the contract mapping from the rows. */
export function toMappingSpec(
  rows: readonly FieldMapping[],
  type: UiObjectType,
): MappingSpec {
  const fields: MappingSpec['fields'] = [];
  const links: NonNullable<MappingSpec['links']> = [];
  let primaryKey: MappingSpec['primaryKey'] = {from: ''};
  for (const r of rows) {
    const t = r.target;
    if (!t) continue;
    if (t.kind === 'prop') {
      const transform = r.transform.trim() || undefined;
      fields.push({
        to: t.prop,
        from: r.source,
        ...(transform ? {transform} : {}),
        ...(r.matchedBy ? {matchedBy: r.matchedBy} : {}),
      });
      if (t.prop === type.primaryKey && !primaryKey.from) {
        primaryKey = {from: r.source, ...(transform ? {transform} : {})};
      }
    } else {
      const split = r.split.trim() ? r.split.slice(0, 4) : undefined;
      links.push({
        type: t.linkType,
        toType: t.toType,
        toKey: r.source,
        ...(split ? {split} : {}),
      });
    }
  }
  return {
    targetType: type.apiName,
    primaryKey,
    fields,
    ...(links.length > 0 ? {links} : {}),
  };
}

/** Source columns referenced by a mapping (the only ones uploaded). */
export function usedColumns(spec: MappingSpec): string[] {
  const cols = new Set<string>();
  if (spec.primaryKey.from) cols.add(spec.primaryKey.from);
  for (const f of spec.fields) cols.add(f.from);
  for (const l of spec.links ?? []) {
    cols.add(l.toKey);
    if (l.weightFrom) cols.add(l.weightFrom);
  }
  return [...cols];
}
