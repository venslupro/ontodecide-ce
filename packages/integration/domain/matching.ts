/**
 * @fileoverview Deterministic mapping draft (详细设计 6.11.2): source
 * columns are matched to target properties by exact (normalized) name, a
 * Chinese / English synonym table plus display names, then string
 * similarity. Link columns are detected from the target type's primary key
 * and weights from share / weight columns. Only what stays unmatched is
 * offered to the AI port.
 */

import {resolveText} from '@ontodecide/shared-kernel';
import type {I18nText} from '@ontodecide/shared-kernel';
import type {
  CompiledObjectType,
  CompiledSchema,
  PropertyDef,
} from '@ontodecide/ontology/contract';
import type {MappingSpec, MatchedBy} from '../contract';

/** Every label of a display text. */
function labels(text: I18nText | undefined): string[] {
  if (!text) return [];
  if (typeof text === 'string') return [text];
  return Object.values(text).filter((s): s is string => !!s);
}

/** Normalizes a name: lower case without separators and punctuation. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s_\-.:/\\()[\]（）【】#·]+/g, '');
}

/**
 * Synonyms by normalized property name (English and Chinese). Display
 * names of the property are added at match time.
 */
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
    'itemname',
    '名称',
    '名字',
    '供应商名称',
    '物料名称',
    '产品名称',
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
    '供应商代码',
    '供应商id',
  ],
  materialid: [
    'material',
    'materialcode',
    'materialno',
    'part',
    'partid',
    'partno',
    'partnumber',
    'itemid',
    'itemcode',
    '物料',
    '物料编号',
    '物料编码',
    '物料号',
    '料号',
  ],
  productid: [
    'product',
    'productcode',
    'productno',
    'sku',
    'model',
    '产品',
    '产品编号',
    '产品编码',
    '产品型号',
  ],
  country: [
    'nation',
    'countrycode',
    'origin',
    'countryoforigin',
    'region',
    '国家',
    '国别',
    '产地',
    '国家地区',
    '地区',
  ],
  riskscore: [
    'risk',
    'riskrating',
    'risklevel',
    'riskindex',
    'riskvalue',
    '风险',
    '风险分',
    '风险评分',
    '风险分数',
    '风险值',
    '风险指数',
  ],
  capacity: [
    'dailycapacity',
    'capacityperday',
    'output',
    'throughput',
    'productioncapacity',
    '产能',
    '日产能',
    '产量',
    '生产能力',
  ],
  ontimerate: [
    'ontime',
    'otd',
    'otif',
    'ontimedelivery',
    'ontimedeliveryrate',
    'deliveryrate',
    'punctuality',
    '准时率',
    '准时交付率',
    '交付准时率',
    '按时交付率',
  ],
  status: ['state', 'suppliersstatus', 'supplierstatus', '状态', '供应商状态'],
  category: [
    'type',
    'class',
    'group',
    'materialcategory',
    'materialtype',
    '类别',
    '分类',
    '类型',
    '品类',
  ],
  safetystock: [
    'minstock',
    'minimumstock',
    'reorderpoint',
    'safetylevel',
    'safetyinventory',
    '安全库存',
    '安全库存量',
    '最低库存',
  ],
  stock: [
    'inventory',
    'onhand',
    'qty',
    'quantity',
    'stocklevel',
    'stockonhand',
    'currentstock',
    '库存',
    '库存量',
    '现有库存',
    '当前库存',
  ],
  revenue: [
    'sales',
    'income',
    'turnover',
    'annualrevenue',
    'revenuecny',
    '收入',
    '营收',
    '销售额',
    '营业额',
  ],
};

/** Columns that carry link weights. */
const WEIGHT_NAMES = new Set(
  [
    'weight',
    'share',
    'ratio',
    'proportion',
    'percentage',
    'percent',
    'supplyshare',
    '权重',
    '占比',
    '份额',
    '比例',
    '供应占比',
  ].map(normalizeName),
);

/** Minimum similarity for a `similarity` match. */
export const SIMILARITY_THRESHOLD = 0.85;

/** Jaro-Winkler similarity of two strings (0..1). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const m = matches;
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

function synonymsOf(p: PropertyDef): Set<string> {
  const out = new Set<string>();
  for (const s of SYNONYMS[normalizeName(p.apiName)] ?? []) {
    out.add(normalizeName(s));
  }
  for (const label of labels(p.displayName)) out.add(normalizeName(label));
  return out;
}

/** Suggested transform for a property's data type. */
export function transformFor(p: PropertyDef): string {
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
    case 'enum':
      return (p.enumValues ?? []).every(v => v === v.toLowerCase())
        ? 'trim|lower'
        : 'trim';
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

function scoreOf(field: string, p: PropertyDef): Candidate | null {
  const f = normalizeName(field);
  if (!f) return null;
  if (f === normalizeName(p.apiName)) {
    return {field, prop: p.apiName, by: 'exact', score: 3};
  }
  if (synonymsOf(p).has(f)) {
    return {field, prop: p.apiName, by: 'synonym', score: 2};
  }
  const sim = Math.max(
    nameSimilarity(field, p.apiName),
    nameSimilarity(field, resolveText(p.displayName, 'en-US')),
  );
  return sim >= SIMILARITY_THRESHOLD
    ? {field, prop: p.apiName, by: 'similarity', score: 1 + sim}
    : null;
}

/** Deterministic draft result. */
export interface RuleDraft {
  spec: MappingSpec;
  /** Source columns not used by a field, the key or a link. */
  unmatchedFields: string[];
  /** Target properties no column was matched to. */
  unmatchedProps: string[];
}

function detectSplit(values: readonly unknown[]): string | undefined {
  const texts = values.filter(v => typeof v === 'string') as string[];
  for (const sep of [';', '|', ',', '、', '；']) {
    if (texts.some(t => t.includes(sep))) return sep;
  }
  return undefined;
}

function linkColumnNames(target: CompiledObjectType): Set<string> {
  const names = new Set<string>();
  const add = (s: string | undefined) => {
    if (!s) return;
    const n = normalizeName(s);
    names.add(n);
    names.add(`${n}s`);
    names.add(`${n}ids`);
  };
  add(target.apiName);
  add(target.primaryKey);
  for (const label of labels(target.displayName)) add(label);
  for (const s of SYNONYMS[normalizeName(target.primaryKey)] ?? []) add(s);
  return names;
}

/**
 * Builds the deterministic draft for `type`. `samples` holds up to 20 rows
 * aligned with `fields` (used to detect link separators).
 */
export function ruleDraft(
  schema: CompiledSchema,
  type: CompiledObjectType,
  fields: readonly string[],
  samples: readonly (readonly unknown[])[],
): RuleDraft {
  const candidates: Candidate[] = [];
  for (const field of fields) {
    for (const p of type.properties) {
      const c = scoreOf(field, p);
      if (c) candidates.push(c);
    }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      fields.indexOf(a.field) - fields.indexOf(b.field) ||
      a.prop.localeCompare(b.prop),
  );
  const usedFields = new Set<string>();
  const byProp = new Map<string, Candidate>();
  for (const c of candidates) {
    if (usedFields.has(c.field) || byProp.has(c.prop)) continue;
    usedFields.add(c.field);
    byProp.set(c.prop, c);
  }

  const links: NonNullable<MappingSpec['links']> = [];
  const column = (field: string) => samples.map(r => r[fields.indexOf(field)]);
  for (const lt of Object.values(schema.linkTypes)) {
    if (lt.from !== type.apiName) continue;
    const target = schema.objectTypes[lt.to];
    if (!target) continue;
    const names = linkColumnNames(target);
    const field = fields.find(
      f => !usedFields.has(f) && names.has(normalizeName(f)),
    );
    if (!field) continue;
    usedFields.add(field);
    const split = detectSplit(column(field));
    const weightFrom = fields.find(
      f => !usedFields.has(f) && WEIGHT_NAMES.has(normalizeName(f)),
    );
    if (weightFrom) usedFields.add(weightFrom);
    links.push({
      type: lt.apiName,
      toType: lt.to,
      toKey: field,
      ...(split ? {split} : {}),
      ...(weightFrom ? {weightFrom} : {}),
    });
  }

  const specFields: MappingSpec['fields'] = [];
  for (const p of type.properties) {
    const c = byProp.get(p.apiName);
    if (!c) continue;
    specFields.push({
      to: p.apiName,
      from: c.field,
      transform: transformFor(p),
      matchedBy: c.by,
    });
  }
  const pk = byProp.get(type.primaryKey);
  return {
    spec: {
      targetType: type.apiName,
      primaryKey: {from: pk?.field ?? '', transform: 'trim'},
      fields: specFields,
      ...(links.length > 0 ? {links} : {}),
    },
    unmatchedFields: fields.filter(f => !usedFields.has(f)),
    unmatchedProps: type.properties
      .filter(p => !byProp.has(p.apiName))
      .map(p => p.apiName),
  };
}

/**
 * Adds AI suggestions to a rule draft. Only pairs of an unmatched column
 * and an unmatched, non-sensitive property are accepted, each at most once.
 */
export function mergeAiPairs(
  draft: RuleDraft,
  type: CompiledObjectType,
  pairs: readonly {from: string; to: string}[],
): RuleDraft {
  const fields = new Set(draft.unmatchedFields);
  const props = new Set(
    draft.unmatchedProps.filter(p => !type.propsByName[p]?.sensitive),
  );
  const added: MappingSpec['fields'] = [];
  for (const {from, to} of pairs) {
    if (!fields.has(from) || !props.has(to)) continue;
    fields.delete(from);
    props.delete(to);
    added.push({
      to,
      from,
      transform: transformFor(type.propsByName[to]),
      matchedBy: 'ai',
    });
  }
  const spec: MappingSpec = {
    ...draft.spec,
    fields: [...draft.spec.fields, ...added],
  };
  const pk = added.find(f => f.to === type.primaryKey);
  if (!spec.primaryKey.from && pk) {
    spec.primaryKey = {from: pk.from, transform: 'trim'};
  }
  return {
    spec,
    unmatchedFields: draft.unmatchedFields.filter(f => fields.has(f)),
    unmatchedProps: draft.unmatchedProps.filter(
      p => !added.some(f => f.to === p),
    ),
  };
}
