/**
 * @fileoverview Declarative function evaluation (JSONLogic safe subset,
 * bounded to 1,000 steps by the shared kernel; no eval).
 */

import {AppError, evalLogic} from '@ontodecide/shared-kernel';
import type {CompiledSchema} from '../contract';

/** Evaluates function `name` of a compiled ontology against properties. */
export function evaluateFunction(
  schema: CompiledSchema,
  name: string,
  props: Record<string, unknown>,
): unknown {
  const fn = schema.functions[name];
  if (!fn) throw new AppError('NOT_FOUND', `Unknown function: ${name}`);
  return evalLogic(fn.expr, props);
}
