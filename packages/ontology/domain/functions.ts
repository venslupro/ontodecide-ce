/**
 * @fileoverview Evaluation of declarative (JSONLogic) ontology functions.
 */

import {evalLogic} from '@ontodecide/shared-kernel';
import type {FunctionDef} from '../contract';

/**
 * Evaluates a function against an object's properties. The data context is
 * the property map itself (`{"var": "riskScore"}`). Evaluation is bounded to
 * 1,000 steps and throws VALIDATION_FAILED on unsupported operators.
 */
export function evaluateFunction(
  fn: FunctionDef,
  props: Record<string, unknown>,
): unknown {
  const result = evalLogic(fn.expr, props);
  return result === undefined ? null : result;
}
