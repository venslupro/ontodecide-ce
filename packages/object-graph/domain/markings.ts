/**
 * @fileoverview Property-level markings: a property carrying markings is
 * visible only to callers holding all of them. System contexts see all.
 */

import {hasMarking, isSystemCtx} from '@ontodecide/shared-kernel';
import type {CallCtx, Provenance} from '@ontodecide/shared-kernel';

/** The part of an object type needed for markings checks. */
export interface MarkedType {
  properties: readonly {apiName: string; markings?: string[]}[];
}

/** Names of the properties of a type the caller may not see. */
export function hiddenPropNames(
  ctx: CallCtx,
  type: MarkedType | undefined,
): Set<string> {
  const hidden = new Set<string>();
  if (!type || isSystemCtx(ctx)) return hidden;
  for (const p of type.properties) {
    if (p.markings?.length && !p.markings.every(m => hasMarking(ctx, m))) {
      hidden.add(p.apiName);
    }
  }
  return hidden;
}

/** Properties after markings filtering. */
export interface VisibleProps<P = Provenance> {
  props: Record<string, unknown>;
  provenance: Record<string, P>;
  /** Hidden property names present on the object. */
  hiddenProps: string[];
}

/** Removes properties (and their provenance) the caller may not see. */
export function filterByMarkings<P = Provenance>(
  ctx: CallCtx,
  type: MarkedType | undefined,
  props: Record<string, unknown>,
  provenance: Record<string, P> = {},
): VisibleProps<P> {
  const hidden = hiddenPropNames(ctx, type);
  if (hidden.size === 0) {
    return {props: {...props}, provenance: {...provenance}, hiddenProps: []};
  }
  const outProps: Record<string, unknown> = {};
  const outProv: Record<string, P> = {};
  const hiddenProps = new Set<string>();
  for (const [k, v] of Object.entries(props)) {
    if (hidden.has(k)) hiddenProps.add(k);
    else outProps[k] = v;
  }
  for (const [k, v] of Object.entries(provenance)) {
    if (hidden.has(k)) hiddenProps.add(k);
    else outProv[k] = v;
  }
  return {props: outProps, provenance: outProv, hiddenProps: [...hiddenProps]};
}
