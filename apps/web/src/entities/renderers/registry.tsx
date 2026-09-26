/**
 * @fileoverview Value renderer registry (open/closed): every ontology data
 * type maps to a renderer providing a table cell, a form input and the
 * filter operators it supports. New types only need `registerRenderer`.
 */

import type {DataType} from '@ontodecide/ontology/contract';
import type {FilterValue} from '@ontodecide/shared-kernel';
import {Link} from '@tanstack/react-router';
import {Check, MapPin, Minus, X} from 'lucide-react';
import type {ReactNode} from 'react';
import type {ControllerRenderProps} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../shared/ui/badge';
import {Input} from '../../shared/ui/input';
import {NativeSelect} from '../../shared/ui/select';
import {Switch} from '../../shared/ui/switch';
import {fmt} from '../../shared/lib/format';
import {ObjectRefInput} from './object_ref_input';

/** Filter operators (subset of FilterExpr ops usable on one property). */
export type FilterOp =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';

/** Registry key: a scalar data type or `objectRef` for every `objectRef:*`. */
export type RendererKey =
  Exclude<DataType, `objectRef:${string}`> | 'objectRef';

/** Property metadata a renderer needs. */
export interface RenderProp {
  apiName: string;
  displayName: string;
  dataType: DataType | string;
  unit?: string;
  enumValues?: string[];
  required?: boolean;
}

/** Input rendering options. */
export interface InputOpts {
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** For objectRef inputs: suggested candidates. */
  suggestions?: {rid: string; title: string}[];
}

/** A value renderer. */
export interface ValueRenderer<T = unknown> {
  /** Table / property cell. */
  cell(v: T, p: RenderProp): ReactNode;
  /** Plain text (tooltips, CSV, tests). */
  text(v: T, p: RenderProp): string;
  /** Form input bound to a react-hook-form field. */
  input(
    p: RenderProp,
    field: ControllerRenderProps<Record<string, unknown>, string>,
    opts?: InputOpts,
  ): ReactNode;
  /** Operators offered by the filter builder. */
  filterOps: FilterOp[];
  /** Parses user input (filter value / form string) to a typed value. */
  parse(raw: string, p: RenderProp): FilterValue | null;
  align: 'left' | 'right';
}

/** The registry. */
export const renderers = new Map<RendererKey, ValueRenderer>();

/** Registers (or replaces) a renderer. */
export function registerRenderer(key: RendererKey, r: ValueRenderer): void {
  renderers.set(key, r);
}

/** Maps a data type to its registry key. */
export function rendererKey(dataType: DataType | string): RendererKey {
  if (dataType.startsWith('objectRef:')) return 'objectRef';
  return dataType as RendererKey;
}

/** Target object type of an `objectRef:<Type>` data type. */
export function refTarget(dataType: DataType | string): string | undefined {
  return dataType.startsWith('objectRef:')
    ? dataType.slice('objectRef:'.length)
    : undefined;
}

/** Returns the renderer for a data type (falls back to `string`). */
export function getRenderer(dataType: DataType | string): ValueRenderer {
  return renderers.get(rendererKey(dataType)) ?? renderers.get('string')!;
}

const EMPTY = '—';

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function Empty() {
  return <span className="text-dim">{EMPTY}</span>;
}

function withUnit(s: string, unit?: string): string {
  return unit ? `${s} ${unit}` : s;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function BoolCell({v}: {v: unknown}) {
  const {t} = useTranslation('common');
  if (isEmpty(v)) return <Empty />;
  const yes = v === true || v === 'true';
  return (
    <span
      className={
        yes
          ? 'inline-flex items-center gap-1 text-good'
          : 'inline-flex items-center gap-1 text-muted'
      }
    >
      {yes ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <X className="size-3.5" aria-hidden />
      )}
      {yes ? t('bool.true') : t('bool.false')}
    </span>
  );
}

function numberRenderer(integer: boolean): ValueRenderer {
  return {
    align: 'right',
    filterOps: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists'],
    text(v, p) {
      const n = toNumber(v);
      if (n === null) return EMPTY;
      return withUnit(
        fmt.number(n, integer ? {maximumFractionDigits: 0} : undefined),
        p.unit,
      );
    },
    cell(v, p) {
      const n = toNumber(v);
      if (n === null) return <Empty />;
      return (
        <span className="num fade-in">
          {fmt.number(n, integer ? {maximumFractionDigits: 0} : undefined)}
          {p.unit && <span className="ml-1 text-xs text-dim">{p.unit}</span>}
        </span>
      );
    },
    input(p, field, o) {
      return (
        <Input
          id={o?.id}
          type="number"
          inputMode={integer ? 'numeric' : 'decimal'}
          step={integer ? 1 : 'any'}
          aria-invalid={o?.invalid || undefined}
          disabled={o?.disabled}
          placeholder={o?.placeholder ?? p.unit}
          name={field.name}
          ref={field.ref}
          onBlur={field.onBlur}
          value={
            field.value === null || field.value === undefined
              ? ''
              : String(field.value)
          }
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') return field.onChange(null);
            const n = Number(raw);
            field.onChange(
              Number.isFinite(n) ? (integer ? Math.trunc(n) : n) : raw,
            );
          }}
        />
      );
    },
    parse(raw) {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n)) return null;
      return integer ? Math.trunc(n) : n;
    },
  };
}

const stringRenderer: ValueRenderer = {
  align: 'left',
  filterOps: ['eq', 'neq', 'contains', 'in', 'exists'],
  text: v => (isEmpty(v) ? EMPTY : String(v)),
  cell: v =>
    isEmpty(v) ? <Empty /> : <span className="break-words">{String(v)}</span>,
  input: (p, field, o) => (
    <Input
      id={o?.id}
      aria-invalid={o?.invalid || undefined}
      disabled={o?.disabled}
      placeholder={o?.placeholder}
      name={field.name}
      ref={field.ref}
      onBlur={field.onBlur}
      value={isEmpty(field.value) ? '' : String(field.value)}
      onChange={e =>
        field.onChange(
          e.target.value === '' && !p.required ? null : e.target.value,
        )
      }
    />
  ),
  parse: raw => (raw === '' ? null : raw),
};

const booleanRenderer: ValueRenderer = {
  align: 'left',
  filterOps: ['eq', 'exists'],
  text: v =>
    isEmpty(v) ? EMPTY : v === true || v === 'true' ? 'true' : 'false',
  cell: v => <BoolCell v={v} />,
  input: (p, field, o) => (
    <Switch
      id={o?.id}
      aria-label={p.displayName}
      disabled={o?.disabled}
      checked={field.value === true}
      onCheckedChange={c => field.onChange(c)}
      onBlur={field.onBlur}
      name={field.name}
    />
  ),
  parse: raw => (raw === 'true' ? true : raw === 'false' ? false : null),
};

function toDateOnly(v: unknown): string | null {
  if (isEmpty(v)) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const dateRenderer: ValueRenderer = {
  align: 'left',
  filterOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'exists'],
  text: v => {
    const d = toDateOnly(v);
    return d ? fmt.date(`${d}T00:00:00`) : EMPTY;
  },
  cell: v => {
    const d = toDateOnly(v);
    return d ? (
      <span className="num">{fmt.date(`${d}T00:00:00`)}</span>
    ) : (
      <Empty />
    );
  },
  input: (_p, field, o) => (
    <Input
      id={o?.id}
      type="date"
      aria-invalid={o?.invalid || undefined}
      disabled={o?.disabled}
      name={field.name}
      ref={field.ref}
      onBlur={field.onBlur}
      value={toDateOnly(field.value) ?? ''}
      onChange={e => field.onChange(e.target.value || null)}
    />
  ),
  parse: raw => toDateOnly(raw),
};

function toLocalInput(v: unknown): string {
  if (isEmpty(v)) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const timestampRenderer: ValueRenderer = {
  align: 'left',
  filterOps: ['eq', 'gt', 'gte', 'lt', 'lte', 'exists'],
  text: v => (isEmpty(v) ? EMPTY : fmt.dateTime(String(v))),
  cell: v =>
    isEmpty(v) ? (
      <Empty />
    ) : (
      <time className="num" dateTime={String(v)} title={String(v)}>
        {fmt.dateTime(String(v))}
      </time>
    ),
  input: (_p, field, o) => (
    <Input
      id={o?.id}
      type="datetime-local"
      aria-invalid={o?.invalid || undefined}
      disabled={o?.disabled}
      name={field.name}
      ref={field.ref}
      onBlur={field.onBlur}
      value={toLocalInput(field.value)}
      onChange={e =>
        field.onChange(
          e.target.value ? new Date(e.target.value).toISOString() : null,
        )
      }
    />
  ),
  parse: raw => {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },
};

/** Parses a geopoint from `{lat,lon}`, `[lat,lon]` or `"lat,lon"`. */
export function parseGeopoint(v: unknown): {lat: number; lon: number} | null {
  if (isEmpty(v)) return null;
  if (Array.isArray(v) && v.length >= 2) {
    const [lat, lon] = v.map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) ? {lat, lon} : null;
  }
  if (typeof v === 'object') {
    const o = v as {lat?: unknown; lon?: unknown; lng?: unknown};
    const lat = Number(o.lat);
    const lon = Number(o.lon ?? o.lng);
    return Number.isFinite(lat) && Number.isFinite(lon) ? {lat, lon} : null;
  }
  const m = String(v)
    .split(',')
    .map(s => Number(s.trim()));
  return m.length === 2 && m.every(Number.isFinite)
    ? {lat: m[0], lon: m[1]}
    : null;
}

const geoText = (v: unknown) => {
  const g = parseGeopoint(v);
  return g ? `${g.lat.toFixed(4)}, ${g.lon.toFixed(4)}` : EMPTY;
};

const geopointRenderer: ValueRenderer = {
  align: 'left',
  filterOps: ['exists'],
  text: geoText,
  cell: v =>
    parseGeopoint(v) ? (
      <span className="inline-flex items-center gap-1 font-mono text-xs">
        <MapPin className="size-3 text-cyan" aria-hidden />
        {geoText(v)}
      </span>
    ) : (
      <Empty />
    ),
  input: (_p, field, o) => (
    <Input
      id={o?.id}
      placeholder="31.2304, 121.4737"
      aria-invalid={o?.invalid || undefined}
      disabled={o?.disabled}
      name={field.name}
      ref={field.ref}
      onBlur={field.onBlur}
      value={
        typeof field.value === 'string'
          ? field.value
          : parseGeopoint(field.value)
            ? `${parseGeopoint(field.value)!.lat}, ${parseGeopoint(field.value)!.lon}`
            : ''
      }
      onChange={e =>
        field.onChange(
          parseGeopoint(e.target.value) ?? (e.target.value || null),
        )
      }
    />
  ),
  parse: raw => (parseGeopoint(raw) ? raw : null),
};

const enumRenderer: ValueRenderer = {
  align: 'left',
  filterOps: ['eq', 'neq', 'in', 'exists'],
  text: v => (isEmpty(v) ? EMPTY : String(v)),
  cell: v => (isEmpty(v) ? <Empty /> : <Badge tone="blue">{String(v)}</Badge>),
  input: (p, field, o) => (
    <NativeSelect
      id={o?.id}
      aria-invalid={o?.invalid || undefined}
      aria-label={p.displayName}
      disabled={o?.disabled}
      name={field.name}
      ref={field.ref}
      onBlur={field.onBlur}
      value={isEmpty(field.value) ? '' : String(field.value)}
      onChange={e => field.onChange(e.target.value || null)}
      placeholder={p.required ? undefined : EMPTY}
      options={(p.enumValues ?? []).map(v => ({value: v, label: v}))}
    />
  ),
  parse: (raw, p) =>
    raw === ''
      ? null
      : !p.enumValues || p.enumValues.includes(raw)
        ? raw
        : null,
};

function shortRid(rid: string): string {
  const parts = rid.split('.');
  return parts.length === 4 ? `${parts[2]}·${parts[3].slice(-6)}` : rid;
}

const objectRefRenderer: ValueRenderer = {
  align: 'left',
  filterOps: ['eq', 'exists'],
  text: v => (isEmpty(v) ? EMPTY : String(v)),
  cell: v => {
    if (isEmpty(v)) return <Empty />;
    const s = String(v);
    if (!s.startsWith('ri.')) return <span>{s}</span>;
    return (
      <Link
        to="/objects/rid/$rid"
        params={{rid: s}}
        className="font-mono text-xs text-cyan hover:underline"
        title={s}
      >
        {shortRid(s)}
      </Link>
    );
  },
  input: (p, field, o) => (
    <ObjectRefInput
      id={o?.id}
      objectType={refTarget(p.dataType)}
      value={isEmpty(field.value) ? '' : String(field.value)}
      onChange={v => field.onChange(v || null)}
      onBlur={field.onBlur}
      invalid={o?.invalid}
      disabled={o?.disabled}
      suggestions={o?.suggestions}
      label={p.displayName}
    />
  ),
  parse: raw => (raw === '' ? null : raw),
};

registerRenderer('string', stringRenderer);
registerRenderer('integer', numberRenderer(true));
registerRenderer('double', numberRenderer(false));
registerRenderer('boolean', booleanRenderer);
registerRenderer('date', dateRenderer);
registerRenderer('timestamp', timestampRenderer);
registerRenderer('geopoint', geopointRenderer);
registerRenderer('enum', enumRenderer);
registerRenderer('objectRef', objectRefRenderer);

/** Renders a hidden-by-markings placeholder. */
export function HiddenValue() {
  const {t} = useTranslation('common');
  return (
    <span
      className="inline-flex items-center gap-1 text-dim"
      title={t('markings.hidden')}
    >
      <Minus className="size-3" aria-hidden />
      <span className="sr-only">{t('markings.hidden')}</span>
    </span>
  );
}
