/**
 * @fileoverview Action execution rules: parameter normalization,
 * preconditions (JSONLogic over `{target, params}`) and effects producing new
 * properties and link changes. Pure; objectRef parameters are resolved to
 * RIDs by the caller before effects run.
 */

import {AppError, evalLogic, resolveText} from '@ontodecide/shared-kernel';
import type {JsonLogic, Rid} from '@ontodecide/shared-kernel';
import type {ActionTypeDef, ParamDef} from '@ontodecide/ontology/contract';
import {linkKey} from './stored_object';
import type {StoredLink} from './stored_object';

/** Parameter normalization result. */
export interface NormalizedParams {
  params: Record<string, unknown>;
  errors: {param: string; detail: string}[];
}

function coerceParam(
  def: ParamDef,
  value: unknown,
): {ok: boolean; value: unknown} {
  const t = def.dataType;
  if (t === 'integer' || t === 'double') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return {ok: false, value};
    return {ok: true, value: t === 'integer' ? Math.trunc(n) : n};
  }
  if (t === 'boolean') {
    if (typeof value === 'boolean') return {ok: true, value};
    if (value === 'true' || value === 1) return {ok: true, value: true};
    if (value === 'false' || value === 0) return {ok: true, value: false};
    return {ok: false, value};
  }
  if (t === 'enum') return {ok: true, value: String(value)};
  if (typeof value === 'object') return {ok: false, value};
  return {ok: true, value: String(value)};
}

/** Applies defaults, checks required parameters and coerces types. */
export function normalizeParams(
  action: ActionTypeDef,
  raw: Record<string, unknown>,
): NormalizedParams {
  const params: Record<string, unknown> = {};
  const errors: {param: string; detail: string}[] = [];
  for (const def of action.parameters) {
    let v = raw[def.apiName];
    if (v === undefined || v === null || v === '') v = def.defaultValue;
    if (v === undefined || v === null || v === '') {
      if (def.required) {
        errors.push({param: def.apiName, detail: 'Parameter is required'});
      }
      continue;
    }
    const c = coerceParam(def, v);
    if (!c.ok) {
      errors.push({param: def.apiName, detail: `Expected ${def.dataType}`});
      continue;
    }
    params[def.apiName] = c.value;
  }
  return {params, errors};
}

/** Parameters referencing objects (`objectRef:<Type>`). */
export function objectRefParams(
  action: ActionTypeDef,
): {param: string; objectType: string}[] {
  return action.parameters
    .filter(p => p.dataType.startsWith('objectRef:'))
    .map(p => ({
      param: p.apiName,
      objectType: p.dataType.slice('objectRef:'.length),
    }));
}

function truthy(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

/** Evaluates preconditions; returns the messages of unmet ones. */
export function evaluatePreconditions(
  action: ActionTypeDef,
  target: Record<string, unknown>,
  params: Record<string, unknown>,
  locale = 'en-US',
): string[] {
  const data = {target, params};
  return action.preconditions
    .filter(pc => !truthy(evalLogic(pc.expr, data)))
    .map(pc => resolveText(pc.message, locale, 'Precondition failed'));
}

/** A link change requested by an effect. */
export interface LinkEffect {
  kind: 'relink' | 'unlink';
  link: string;
  direction: 'in' | 'out';
  /** Resolved RID of the other end (relink: required). */
  to?: Rid;
}

/** Effects applied to a target. */
export interface EffectOutcome {
  /** Property updates (full new values; null deletes). */
  updates: Record<string, unknown>;
  linkEffects: LinkEffect[];
}

/**
 * Computes effects. `params` must already hold RIDs for objectRef
 * parameters used by relink/unlink.
 */
export function applyEffects(
  action: ActionTypeDef,
  target: Record<string, unknown>,
  params: Record<string, unknown>,
): EffectOutcome {
  const data = {target, params};
  const working: Record<string, unknown> = {...target};
  const updates: Record<string, unknown> = {};
  const linkEffects: LinkEffect[] = [];
  for (const e of action.effects) {
    switch (e.kind) {
      case 'set': {
        const v = evalLogic(e.value as JsonLogic, data);
        working[e.prop] = v;
        updates[e.prop] = v;
        break;
      }
      case 'increment': {
        const by = Number(evalLogic(e.by as JsonLogic, data));
        const base = Number(working[e.prop] ?? 0);
        const v = base + by;
        if (!Number.isFinite(v)) {
          throw new AppError(
            'VALIDATION_FAILED',
            `Cannot increment ${e.prop}: not a number`,
          );
        }
        working[e.prop] = v;
        updates[e.prop] = v;
        break;
      }
      case 'relink': {
        const to = params[e.toParam];
        if (typeof to !== 'string' || !to) {
          throw new AppError(
            'VALIDATION_FAILED',
            `Parameter ${e.toParam} is required`,
          );
        }
        linkEffects.push({
          kind: 'relink',
          link: e.link,
          direction: e.direction,
          to: to as Rid,
        });
        break;
      }
      case 'unlink': {
        const to = e.toParam ? params[e.toParam] : undefined;
        linkEffects.push({
          kind: 'unlink',
          link: e.link,
          direction: e.direction,
          ...(typeof to === 'string' && to ? {to: to as Rid} : {}),
        });
        break;
      }
      default:
        break;
    }
  }
  return {updates, linkEffects};
}

/** Links to remove and add. */
export interface LinkChanges {
  remove: StoredLink[];
  add: StoredLink[];
}

/**
 * Plans link changes for a target from its current links. `relink`
 * replaces every link of the type on that side with one to `to` (carrying
 * over the weight of a replaced link); `unlink` removes them (or only the
 * one to `to`).
 */
export function planLinkChanges(
  target: Rid,
  effects: readonly LinkEffect[],
  existing: readonly StoredLink[],
): LinkChanges {
  const current = new Map(existing.map(l => [linkKey(l), l]));
  const removed = new Map<string, StoredLink>();
  const added = new Map<string, StoredLink>();
  for (const e of effects) {
    const onSide = (l: StoredLink): boolean =>
      l.type === e.link && (e.direction === 'out' ? l.src : l.dst) === target;
    const other = (l: StoredLink): Rid =>
      e.direction === 'out' ? l.dst : l.src;
    const matching = [...current.values()].filter(onSide);
    if (e.kind === 'unlink') {
      for (const l of matching) {
        if (e.to && other(l) !== e.to) continue;
        current.delete(linkKey(l));
        if (added.has(linkKey(l))) added.delete(linkKey(l));
        else removed.set(linkKey(l), l);
      }
      continue;
    }
    const to = e.to!;
    let weight: number | null | undefined;
    for (const l of matching) {
      if (other(l) === to) continue;
      weight ??= l.weight;
      current.delete(linkKey(l));
      if (added.has(linkKey(l))) added.delete(linkKey(l));
      else removed.set(linkKey(l), l);
    }
    const link: StoredLink =
      e.direction === 'out'
        ? {type: e.link, src: target, dst: to, weight: weight ?? null}
        : {type: e.link, src: to, dst: target, weight: weight ?? null};
    const key = linkKey(link);
    if (!current.has(key)) {
      current.set(key, link);
      if (removed.has(key)) removed.delete(key);
      else added.set(key, link);
    }
  }
  return {remove: [...removed.values()], add: [...added.values()]};
}
