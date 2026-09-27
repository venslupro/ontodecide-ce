/**
 * @fileoverview Action execution rules (详细设计 6.11.3): parameter
 * resolution, JSONLogic preconditions and the set / increment / relink /
 * unlink effects. Pure: the application loads the target, its links and the
 * referenced objects, the repository commits the result.
 */

import {AppError, evalLogic, resolveText} from '@ontodecide/shared-kernel';
import type {JsonLogic, Rid} from '@ontodecide/shared-kernel';
import {validateProps} from '@ontodecide/ontology/contract';
import type {
  ActionTypeDef,
  CompiledObjectType,
  CompiledSchema,
  PropertyDef,
} from '@ontodecide/ontology/contract';
import {patchProps} from './conflict_resolution';
import type {PropState} from './conflict_resolution';
import {linkKey} from './entity_resolution';
import type {StoredLink, StoredObject} from './stored_object';

/** An objectRef parameter value that must exist in the workspace. */
export interface ParamRef {
  param: string;
  objectType: string;
  rid: Rid;
}

/** Resolved parameters. */
export interface ResolvedParams {
  params: Record<string, unknown>;
  refs: ParamRef[];
}

/**
 * Applies defaults, coerces values by data type and rejects unknown or
 * missing required parameters (VALIDATION_FAILED, 400).
 */
export function resolveParams(
  action: ActionTypeDef,
  input: Record<string, unknown>,
): ResolvedParams {
  const properties: PropertyDef[] = action.parameters.map(p => ({
    apiName: p.apiName,
    displayName: p.displayName,
    dataType: p.dataType,
    required: p.required,
  }));
  const withDefaults: Record<string, unknown> = {...input};
  for (const p of action.parameters) {
    if (withDefaults[p.apiName] === undefined && p.defaultValue !== undefined) {
      withDefaults[p.apiName] = p.defaultValue;
    }
  }
  const pseudo = {
    apiName: action.apiName,
    displayName: action.displayName,
    primaryKey: '',
    titleProperty: '',
    properties,
    propsByName: Object.fromEntries(properties.map(p => [p.apiName, p])),
    indexedProps: [],
    sensitiveProps: [],
  } as CompiledObjectType;
  const v = validateProps(pseudo, withDefaults, {strict: true});
  if (v.errors.length) {
    throw new AppError('VALIDATION_FAILED', 'Invalid action parameters', {
      extras: {errors: v.errors.map(e => ({prop: e.prop, code: e.code}))},
    });
  }
  const refs: ParamRef[] = [];
  for (const p of action.parameters) {
    const value = v.props[p.apiName];
    if (value === undefined || !p.dataType.startsWith('objectRef:')) continue;
    refs.push({
      param: p.apiName,
      objectType: p.dataType.slice('objectRef:'.length),
      rid: String(value) as Rid,
    });
  }
  return {params: v.props, refs};
}

/** JSONLogic data context of an action: `{target, params}`. */
export function actionData(
  target: StoredObject,
  params: Record<string, unknown>,
): Record<string, unknown> {
  return {
    target: {
      ...target.props,
      rid: target.rid,
      primaryKey: target.primaryKey,
    },
    params,
  };
}

/** Messages of the preconditions that evaluate falsy. */
export function unmetPreconditions(
  action: ActionTypeDef,
  data: Record<string, unknown>,
  locale: string,
): string[] {
  const unmet: string[] = [];
  for (const pre of action.preconditions) {
    const ok = evalLogic(pre.expr, data);
    if (!ok || (Array.isArray(ok) && ok.length === 0)) {
      unmet.push(resolveText(pre.message, locale, 'Precondition not met'));
    }
  }
  return unmet;
}

/** Outcome of an action's effects. */
export interface EffectPlan {
  after: PropState;
  changed: string[];
  removeLinks: StoredLink[];
  addLinks: StoredLink[];
}

function effectFailed(detail: string): never {
  throw new AppError('VALIDATION_FAILED', detail, {status: 422});
}

/**
 * Applies the effects in order. `links` are the target's current links of
 * every link type the effects touch; `refs` maps referenced rids to their
 * object type. Property results are coerced by the target type.
 */
export function applyEffects(input: {
  schema: CompiledSchema;
  action: ActionTypeDef;
  type: CompiledObjectType;
  target: StoredObject;
  params: Record<string, unknown>;
  links: StoredLink[];
  refTypes: Map<string, string>;
}): EffectPlan {
  const {schema, action, type, target, params} = input;
  const data = actionData(target, params);
  const next: Record<string, unknown> = {...target.props};
  const touched = new Set<string>();
  const links = new Map(
    input.links.map(l => [linkKey(l.src, l.type, l.dst), l]),
  );
  for (const effect of action.effects) {
    switch (effect.kind) {
      case 'set': {
        if (!type.propsByName[effect.prop]) {
          effectFailed(`Unknown property ${effect.prop}`);
        }
        next[effect.prop] = evalLogic(effect.value as JsonLogic, data);
        touched.add(effect.prop);
        break;
      }
      case 'increment': {
        if (!type.propsByName[effect.prop]) {
          effectFailed(`Unknown property ${effect.prop}`);
        }
        const by = Number(evalLogic(effect.by as JsonLogic, data));
        const cur = Number(next[effect.prop] ?? 0);
        if (!Number.isFinite(by) || !Number.isFinite(cur)) {
          effectFailed(`Cannot increment ${effect.prop}`);
        }
        next[effect.prop] = cur + by;
        touched.add(effect.prop);
        break;
      }
      case 'relink':
      case 'unlink': {
        const def = schema.linkTypes[effect.link];
        if (!def) effectFailed(`Unknown link type ${effect.link}`);
        const out = effect.direction === 'out';
        if ((out ? def.from : def.to) !== target.type) {
          effectFailed(`Link ${effect.link} does not fit the target`);
        }
        const other = effect.toParam
          ? (params[effect.toParam] as string | undefined)
          : undefined;
        if (effect.kind === 'relink' || effect.toParam) {
          if (!other) effectFailed(`Missing parameter ${effect.toParam}`);
          if (input.refTypes.get(other) !== (out ? def.to : def.from)) {
            effectFailed(`Parameter ${effect.toParam} has the wrong type`);
          }
        }
        for (const [k, l] of links) {
          if (l.type !== effect.link) continue;
          const mine = out ? l.src === target.rid : l.dst === target.rid;
          if (!mine) continue;
          const far = out ? l.dst : l.src;
          if (effect.kind === 'relink' || !other || far === other) {
            links.delete(k);
          }
        }
        if (effect.kind === 'relink' && other) {
          const l: StoredLink = out
            ? {
                src: target.rid,
                type: effect.link,
                dst: other as Rid,
                weight: null,
              }
            : {
                src: other as Rid,
                type: effect.link,
                dst: target.rid,
                weight: null,
              };
          links.set(linkKey(l.src, l.type, l.dst), l);
        }
        break;
      }
    }
  }

  const patch: Record<string, unknown> = {};
  const toCoerce: Record<string, unknown> = {};
  for (const prop of touched) {
    const v = next[prop];
    if (v === null || v === undefined) patch[prop] = null;
    else toCoerce[prop] = v;
  }
  const v = validateProps(type, toCoerce, {partial: true});
  if (v.errors.length) {
    effectFailed(
      `Effect produced invalid values: ${v.errors.map(e => e.prop).join(',')}`,
    );
  }
  for (const prop of touched) {
    const def = type.propsByName[prop];
    if (patch[prop] === null && def.required) {
      effectFailed(`Effect cleared required property ${prop}`);
    }
    if (prop in v.props) patch[prop] = v.props[prop];
  }
  const outcome = patchProps(
    {props: target.props, provenance: target.provenance},
    patch,
  );

  const before = new Map(
    input.links.map(l => [linkKey(l.src, l.type, l.dst), l]),
  );
  return {
    after: outcome.state,
    changed: outcome.changed,
    removeLinks: [...before].filter(([k]) => !links.has(k)).map(([, l]) => l),
    addLinks: [...links].filter(([k]) => !before.has(k)).map(([, l]) => l),
  };
}

/** Link types an action's effects touch. */
export function touchedLinkTypes(action: ActionTypeDef): string[] {
  const out = new Set<string>();
  for (const e of action.effects) {
    if (e.kind === 'relink' || e.kind === 'unlink') out.add(e.link);
  }
  return [...out];
}

/** Subset of props named in `keys` (for before/after snapshots). */
export function pick(
  props: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (props[k] !== undefined) out[k] = props[k];
  return out;
}
