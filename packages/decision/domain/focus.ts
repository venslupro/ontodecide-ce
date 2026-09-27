/**
 * @fileoverview Scenario of a recommendation generated from a focus object
 * (or the alert on it): the focus' risk property becomes one negative
 * perturbation whose size follows the risk value.
 */

import type {CompiledObjectType} from '@ontodecide/ontology/contract';
import type {Perturbation} from '../contract';
import type {ObjectLike} from './candidates';
import {clamp} from './propagation';
import {num, round} from './simulation';

/** Change used when the focus has no numeric risk value. */
export const DEFAULT_FOCUS_CHANGE = -0.5;

/** Smallest perturbation derived from a risk value. */
export const MIN_FOCUS_CHANGE = 0.1;

/** Property name recorded when the object type has no risk property. */
export const GENERIC_RISK_PROPERTY = 'risk';

const NUMERIC = new Set(['integer', 'double']);

/**
 * The risk property of an object type: the first numeric property tagged
 * `risk`, else the first numeric property whose api name contains "risk".
 */
export function riskProperty(
  ot: Pick<CompiledObjectType, 'properties'> | undefined,
): string | undefined {
  if (!ot) return undefined;
  const numeric = ot.properties.filter(p => NUMERIC.has(p.dataType));
  return (
    numeric.find(p => p.semanticTags?.some(t => t.toLowerCase() === 'risk')) ??
    numeric.find(p => /risk/i.test(p.apiName))
  )?.apiName;
}

/**
 * Perturbation for a focus: −(risk / 100) for scores on 0..100 (or −risk
 * for fractions ≤ 1), clamped to [0.1, 1]; −0.5 without a numeric risk.
 */
export function focusPerturbation(
  ot: Pick<CompiledObjectType, 'properties'> | undefined,
  focus: Pick<ObjectLike, 'rid' | 'props'>,
): Perturbation {
  const prop = riskProperty(ot);
  const value = prop ? num(focus.props[prop]) : null;
  if (!prop || value === null) {
    return {
      rid: focus.rid,
      property: prop ?? GENERIC_RISK_PROPERTY,
      change: DEFAULT_FOCUS_CHANGE,
    };
  }
  const fraction = Math.abs(value) > 1 ? value / 100 : value;
  return {
    rid: focus.rid,
    property: prop,
    change: -round(clamp(Math.abs(fraction), MIN_FOCUS_CHANGE, 1), 4),
  };
}
