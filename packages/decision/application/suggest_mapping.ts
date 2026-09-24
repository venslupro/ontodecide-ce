/**
 * @fileoverview AI mapping draft (LLM with whitelist validation, heuristic
 * fallback) and the LLM quota query.
 */

import {parseOrThrow, type CallCtx} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import {
  suggestMappingInputSchema,
  type MappingSuggestion,
  type TargetProp,
} from '../contract';
import {
  buildMappingPrompt,
  heuristicMapping,
  validateMapping,
  type MappingSample,
} from '../domain';
import type {LlmGateway, QuotaView} from './llm_gateway';

const targetPropsSchema = z
  .array(
    z.object({
      apiName: z.string().min(1),
      dataType: z.string().min(1),
      displayName: z.string().optional(),
    }),
  )
  .min(1)
  .max(200);

/** Suggests a source → object type mapping. Counts against LLM quotas. */
export class SuggestMapping {
  constructor(private readonly gateway: LlmGateway) {}

  async execute(
    ctx: CallCtx,
    sample: {
      fields: string[];
      rows: unknown[][];
      targetType: string;
      targetProps: TargetProp[];
    },
  ): Promise<MappingSuggestion> {
    const base = parseOrThrow(suggestMappingInputSchema, {
      fields: sample?.fields,
      rows: sample?.rows ?? [],
      targetType: sample?.targetType,
    });
    const s: MappingSample = {
      ...base,
      targetProps: parseOrThrow(targetPropsSchema, sample.targetProps),
    };
    const res = await this.gateway.complete(ctx, buildMappingPrompt(s), {
      json: true,
      maxTokens: 1200,
      accept: t => validateMapping(t, s, 'x').ok,
    });
    if (res.status === 'ok') {
      const v = validateMapping(res.text, s, res.model);
      if (v.ok) return v.value;
    }
    return heuristicMapping(s);
  }
}

/** Remaining LLM calls today for the caller. */
export class GetLlmQuota {
  constructor(private readonly gateway: LlmGateway) {}

  execute(ctx: CallCtx): Promise<QuotaView> {
    return this.gateway.quota(ctx);
  }
}
