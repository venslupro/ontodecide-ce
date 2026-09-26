/**
 * @fileoverview Transform functions and the transform-chain parser used by
 * field mappings (`trim|toNumber|clamp(0,100)`). The registry is open for
 * extension (`registerTransform`) and closed for modification: built-ins
 * cannot be replaced.
 */

import {AppError} from '@ontodecide/shared-kernel';
import {INGEST_LIMITS} from '../contract';

/** A compiled transform step. Throws {@link TransformError} on bad input. */
export type TransformFn = (value: unknown) => unknown;

/** Builds a transform step from its raw argument text (inside the parens). */
export type TransformFactory = (args: string | undefined) => TransformFn;

/** A value could not be transformed (the record is rejected). */
export class TransformError extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(`${step}: ${message}`);
    this.name = 'TransformError';
  }
}

const REGISTRY = new Map<string, TransformFactory>();
const BUILT_INS = new Set<string>();

/**
 * Registers a custom transform. Built-in names cannot be overridden.
 */
export function registerTransform(
  name: string,
  factory: TransformFactory,
): void {
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
    throw new AppError('VALIDATION_FAILED', `Invalid transform name: ${name}`);
  }
  if (BUILT_INS.has(name)) {
    throw new AppError(
      'CONFLICT',
      `Built-in transform cannot be replaced: ${name}`,
    );
  }
  REGISTRY.set(name, factory);
}

/** Names of every registered transform. */
export function transformNames(): string[] {
  return [...REGISTRY.keys()].sort();
}

function builtIn(name: string, factory: TransformFactory): void {
  REGISTRY.set(name, factory);
  BUILT_INS.add(name);
}

function isEmpty(v: unknown): v is null | undefined | '' {
  return v === null || v === undefined || v === '';
}

function noArgs(name: string, args: string | undefined): void {
  if (args !== undefined && args.trim() !== '') {
    throw new AppError('VALIDATION_FAILED', `${name} takes no arguments`);
  }
}

function num(name: string, raw: string | undefined): number {
  const n = Number((raw ?? '').trim());
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(n)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `${name}: numeric argument expected`,
    );
  }
  return n;
}

function toNumberValue(step: string, v: unknown): number | null {
  if (isEmpty(v)) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v))
      throw new TransformError(step, 'not a finite number');
    return v;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v)
    .trim()
    .replace(/[,\s_]/g, '');
  if (s === '') return null;
  const pct = s.endsWith('%');
  const n = Number(pct ? s.slice(0, -1) : s);
  if (!Number.isFinite(n)) throw new TransformError(step, 'not a number');
  return pct ? n / 100 : n;
}

function stringStep(fn: (s: string) => string): TransformFactory {
  return () => v => (isEmpty(v) ? v : fn(String(v)));
}

/** Parses a literal argument: number, boolean, null or (quoted) string. */
export function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if (/^(['"]).*\1$/.test(s)) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s !== '' && Number.isFinite(Number(s))) return Number(s);
  return s;
}

const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', 't', 'on', '是']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'n', 'f', 'off', '否']);

/** Common country names (lower case) → ISO 3166-1 alpha-2. */
const COUNTRIES: Record<string, string> = {
  china: 'CN',
  "people's republic of china": 'CN',
  prc: 'CN',
  中国: 'CN',
  chn: 'CN',
  'mainland china': 'CN',
  vietnam: 'VN',
  'viet nam': 'VN',
  vnm: 'VN',
  越南: 'VN',
  malaysia: 'MY',
  mys: 'MY',
  马来西亚: 'MY',
  japan: 'JP',
  jpn: 'JP',
  日本: 'JP',
  'south korea': 'KR',
  korea: 'KR',
  'republic of korea': 'KR',
  kor: 'KR',
  韩国: 'KR',
  taiwan: 'TW',
  twn: 'TW',
  台湾: 'TW',
  'hong kong': 'HK',
  hkg: 'HK',
  香港: 'HK',
  singapore: 'SG',
  sgp: 'SG',
  新加坡: 'SG',
  thailand: 'TH',
  tha: 'TH',
  泰国: 'TH',
  indonesia: 'ID',
  idn: 'ID',
  印度尼西亚: 'ID',
  philippines: 'PH',
  phl: 'PH',
  菲律宾: 'PH',
  india: 'IN',
  ind: 'IN',
  印度: 'IN',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  america: 'US',
  美国: 'US',
  canada: 'CA',
  can: 'CA',
  加拿大: 'CA',
  mexico: 'MX',
  mex: 'MX',
  墨西哥: 'MX',
  brazil: 'BR',
  bra: 'BR',
  巴西: 'BR',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  gbr: 'GB',
  英国: 'GB',
  germany: 'DE',
  deu: 'DE',
  德国: 'DE',
  france: 'FR',
  fra: 'FR',
  法国: 'FR',
  italy: 'IT',
  ita: 'IT',
  意大利: 'IT',
  spain: 'ES',
  esp: 'ES',
  西班牙: 'ES',
  netherlands: 'NL',
  'the netherlands': 'NL',
  holland: 'NL',
  nld: 'NL',
  荷兰: 'NL',
  switzerland: 'CH',
  che: 'CH',
  瑞士: 'CH',
  sweden: 'SE',
  swe: 'SE',
  瑞典: 'SE',
  poland: 'PL',
  pol: 'PL',
  波兰: 'PL',
  russia: 'RU',
  'russian federation': 'RU',
  rus: 'RU',
  俄罗斯: 'RU',
  turkey: 'TR',
  türkiye: 'TR',
  turkiye: 'TR',
  tur: 'TR',
  土耳其: 'TR',
  australia: 'AU',
  aus: 'AU',
  澳大利亚: 'AU',
  'new zealand': 'NZ',
  nzl: 'NZ',
  新西兰: 'NZ',
  'south africa': 'ZA',
  zaf: 'ZA',
  南非: 'ZA',
  'united arab emirates': 'AE',
  uae: 'AE',
  are: 'AE',
  阿联酋: 'AE',
  'saudi arabia': 'SA',
  sau: 'SA',
  沙特阿拉伯: 'SA',
  israel: 'IL',
  isr: 'IL',
  以色列: 'IL',
  egypt: 'EG',
  egy: 'EG',
  埃及: 'EG',
  bangladesh: 'BD',
  bgd: 'BD',
  孟加拉国: 'BD',
  pakistan: 'PK',
  pak: 'PK',
  巴基斯坦: 'PK',
  cambodia: 'KH',
  khm: 'KH',
  柬埔寨: 'KH',
  myanmar: 'MM',
  burma: 'MM',
  mmr: 'MM',
  缅甸: 'MM',
  argentina: 'AR',
  arg: 'AR',
  阿根廷: 'AR',
  chile: 'CL',
  chl: 'CL',
  智利: 'CL',
};

/** ISO alpha-2 codes accepted as-is (the targets of {@link COUNTRIES}). */
const ALPHA2 = new Set(Object.values(COUNTRIES));

builtIn('trim', args => {
  noArgs('trim', args);
  return v => (typeof v === 'string' ? v.trim() : v);
});
builtIn('lower', args => {
  noArgs('lower', args);
  return stringStep(s => s.toLowerCase())(undefined);
});
builtIn('upper', args => {
  noArgs('upper', args);
  return stringStep(s => s.toUpperCase())(undefined);
});
builtIn('toNumber', args => {
  noArgs('toNumber', args);
  return v => toNumberValue('toNumber', v);
});
builtIn('toInteger', args => {
  noArgs('toInteger', args);
  return v => {
    const n = toNumberValue('toInteger', v);
    return n === null ? null : Math.trunc(n);
  };
});
builtIn('toBoolean', args => {
  noArgs('toBoolean', args);
  return v => {
    if (isEmpty(v)) return null;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (TRUE_WORDS.has(s)) return true;
    if (FALSE_WORDS.has(s)) return false;
    throw new TransformError('toBoolean', 'not a boolean');
  };
});
builtIn('parseDate', args => {
  noArgs('parseDate', args);
  return v => {
    if (isEmpty(v)) return null;
    let input: string | number;
    if (typeof v === 'number') {
      // Unix seconds vs milliseconds.
      input = v < 1e11 ? v * 1000 : v;
    } else {
      const s = String(v).trim();
      input = /^\d{4}\/\d{1,2}\/\d{1,2}/.test(s) ? s.replace(/\//g, '-') : s;
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(input)) {
        const [y, m, d] = input.split('-');
        input = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
    }
    const d = new Date(input);
    if (Number.isNaN(d.getTime()))
      throw new TransformError('parseDate', 'not a date');
    return d.toISOString();
  };
});
builtIn('clamp', args => {
  const parts = (args ?? '').split(',');
  if (parts.length !== 2) {
    throw new AppError(
      'VALIDATION_FAILED',
      'clamp(min,max) expects 2 arguments',
    );
  }
  const min = num('clamp', parts[0]);
  const max = num('clamp', parts[1]);
  if (min > max) throw new AppError('VALIDATION_FAILED', 'clamp: min > max');
  return v => {
    const n = toNumberValue('clamp', v);
    return n === null ? null : Math.min(max, Math.max(min, n));
  };
});
builtIn('round', args => {
  const digits =
    args === undefined || args.trim() === '' ? 0 : num('round', args);
  if (!Number.isInteger(digits) || digits < 0 || digits > 10) {
    throw new AppError('VALIDATION_FAILED', 'round(n): n must be 0..10');
  }
  const f = 10 ** digits;
  return v => {
    const n = toNumberValue('round', v);
    return n === null ? null : Math.round(n * f) / f;
  };
});
builtIn('default', args => {
  if (args === undefined) {
    throw new AppError('VALIDATION_FAILED', 'default(v) expects 1 argument');
  }
  const fallback = parseLiteral(args);
  return v => (isEmpty(v) ? fallback : v);
});
builtIn('lookup', args => {
  const table = new Map<string, unknown>();
  for (const pair of (args ?? '').split(';')) {
    if (pair.trim() === '') continue;
    const idx = pair.indexOf(':');
    if (idx <= 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'lookup(a:x;b:y) expects key:value pairs',
      );
    }
    table.set(pair.slice(0, idx).trim(), parseLiteral(pair.slice(idx + 1)));
  }
  if (table.size === 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'lookup(a:x;b:y) expects key:value pairs',
    );
  }
  return v => {
    if (isEmpty(v)) return v;
    const key = String(v).trim();
    if (table.has(key)) return table.get(key);
    if (table.has('*')) return table.get('*');
    return v;
  };
});
builtIn('iso3166', args => {
  noArgs('iso3166', args);
  return v => {
    if (isEmpty(v)) return null;
    const s = String(v).trim();
    if (s === '') return null;
    if (/^[A-Za-z]{2}$/.test(s) && ALPHA2.has(s.toUpperCase()))
      return s.toUpperCase();
    const code = COUNTRIES[s.toLowerCase().replace(/\s+/g, ' ')];
    if (!code) throw new TransformError('iso3166', 'unknown country');
    return code;
  };
});
builtIn('split', args => {
  const sep =
    args === undefined || args === '' ? ',' : String(parseLiteral(args) ?? ',');
  return v => {
    if (isEmpty(v)) return [];
    if (Array.isArray(v)) return v;
    return String(v)
      .split(sep)
      .map(s => s.trim())
      .filter(s => s !== '');
  };
});

/** Splits on `sep` outside of parentheses. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** A compiled transform chain. */
export interface TransformChain {
  readonly steps: string[];
  apply(value: unknown): unknown;
}

const IDENTITY: TransformChain = {steps: [], apply: v => v};
const CACHE = new Map<string, TransformChain>();

/**
 * Parses and compiles a chain. Throws VALIDATION_FAILED for unknown
 * transforms, malformed steps or more than 5 steps.
 */
export function compileChain(expr: string | undefined): TransformChain {
  if (expr === undefined || expr.trim() === '') return IDENTITY;
  const cached = CACHE.get(expr);
  if (cached) return cached;
  const raw = splitTopLevel(expr, '|').map(s => s.trim());
  if (raw.length > INGEST_LIMITS.transformChainMax) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Transform chain exceeds ${INGEST_LIMITS.transformChainMax} steps`,
    );
  }
  const fns: TransformFn[] = [];
  for (const step of raw) {
    const m = step.match(/^([a-zA-Z][a-zA-Z0-9]*)\s*(?:\((.*)\))?$/s);
    if (!m)
      throw new AppError('VALIDATION_FAILED', `Malformed transform: ${step}`);
    const factory = REGISTRY.get(m[1]);
    if (!factory)
      throw new AppError('VALIDATION_FAILED', `Unknown transform: ${m[1]}`);
    fns.push(factory(m[2]));
  }
  const chain: TransformChain = {
    steps: raw,
    apply: value => fns.reduce((v, fn) => fn(v), value),
  };
  if (CACHE.size > 500) CACHE.clear();
  CACHE.set(expr, chain);
  return chain;
}
