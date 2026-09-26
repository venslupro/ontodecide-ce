/**
 * @fileoverview EvaluateFunction use case.
 */

import {AppError, type CallCtx} from '@ontodecide/shared-kernel';
import {evaluateFunction} from '../domain';
import type {ActiveModelLoader} from './active_model';

/** Evaluates a declarative function of the active model. */
export class EvaluateFunctionHandler {
  constructor(private readonly models: ActiveModelLoader) {}

  async execute(
    ctx: CallCtx,
    fn: string,
    props: Record<string, unknown>,
  ): Promise<unknown> {
    const model = await this.models.load(ctx.tenantId);
    const def = Object.prototype.hasOwnProperty.call(model.functions, fn)
      ? model.functions[fn]
      : undefined;
    if (!def) throw new AppError('NOT_FOUND', `Function ${fn} not found`);
    return evaluateFunction(def, props ?? {});
  }
}
