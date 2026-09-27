/**
 * @fileoverview POST /imports/{id}/mapping-draft (详细设计 6.11.2, 6.3.5).
 * Deterministic matching first; only unmatched columns go to the AI port,
 * guarded by the per-user daily cap (mapping_ai) and the service Neurons
 * budget (reserve 1.3 × estimate, settle afterwards). Any budget or model
 * failure returns the deterministic draft with rankedBy = rules.
 */

import {AppError, resolveText, utcDay} from '@ontodecide/shared-kernel';
import type {CallCtx} from '@ontodecide/shared-kernel';
import type {CompiledObjectType} from '@ontodecide/ontology/contract';
import type {MappingDraft, MappingDraftInput} from '../contract';
import {mergeAiPairs, ruleDraft} from '../domain';
import type {RuleDraft} from '../domain';
import {requireJob} from './import_handlers';
import type {
  AiField,
  AiMappingRequest,
  IntegrationDeps,
  UsageRef,
} from './ports';

/** Sample values per column sent to the model. */
const AI_SAMPLES = 3;
/** Longest sample value sent to the model. */
const AI_SAMPLE_CHARS = 40;
/** Values that look like personal data are never sent. */
const PERSONAL = /@|^\+?[\d\s()-]{7,}$/;

/** The caller's AI draft counter for today. */
export function mappingAiRef(ctx: CallCtx, now: Date): UsageRef {
  return {day: utcDay(now), scope: ctx.tid, key: 'mapping_ai'};
}

function toDraft(d: RuleDraft, rankedBy: 'ai' | 'rules'): MappingDraft {
  return {...d.spec, rankedBy, unmatched: d.unmatchedFields};
}

function aiRequest(
  type: CompiledObjectType,
  draft: RuleDraft,
  input: MappingDraftInput,
): AiMappingRequest {
  const fields: AiField[] = draft.unmatchedFields.map(name => {
    const idx = input.fields.indexOf(name);
    const samples: string[] = [];
    for (const row of input.sampleRows) {
      if (samples.length >= AI_SAMPLES) break;
      const v = row[idx];
      if (v === null || v === undefined || typeof v === 'object') continue;
      const s = String(v).trim().slice(0, AI_SAMPLE_CHARS);
      if (s && !PERSONAL.test(s)) samples.push(s);
    }
    return {name, samples};
  });
  const props = draft.unmatchedProps
    .map(p => type.propsByName[p])
    .filter(p => p && !p.sensitive)
    .map(p => ({
      apiName: p.apiName,
      dataType: p.dataType,
      label: resolveText(p.displayName, 'en-US', p.apiName),
    }));
  return {targetType: type.apiName, fields, props};
}

/** Builds a mapping draft; see the file overview. */
export async function mappingDraft(
  deps: IntegrationDeps,
  ctx: CallCtx,
  jobId: string,
  input: MappingDraftInput,
): Promise<MappingDraft> {
  await requireJob(deps, ctx, jobId);
  const schema = await deps.ontology.getCompiledSchema(ctx);
  const type = schema.objectTypes[input.targetType];
  if (!type) {
    throw new AppError('VALIDATION_FAILED', `Unknown type ${input.targetType}`);
  }
  const draft = ruleDraft(schema, type, input.fields, input.sampleRows);
  const req = aiRequest(type, draft, input);
  if (!deps.ai || req.fields.length === 0 || req.props.length === 0) {
    return toDraft(draft, 'rules');
  }

  const {config} = deps;
  const now = deps.clock.now();
  const userRef = mappingAiRef(ctx, now);
  if (!(await deps.usage.take(userRef, 1, config.mappingAiDaily))) {
    return toDraft(draft, 'rules');
  }
  const neuronsRef: UsageRef = {day: utcDay(now), scope: '*', key: 'neurons'};
  const reserve = Math.ceil(config.draftNeurons * config.reserveFactor);
  if (
    !(await deps.usage.take(neuronsRef, reserve, config.neuronsDailyBudget))
  ) {
    await deps.usage.adjust(userRef, -1);
    deps.logger.warn('mapping draft: neurons budget exhausted', {tid: ctx.tid});
    return toDraft(draft, 'rules');
  }

  try {
    const res = await deps.ai.suggestMappings(req);
    await deps.usage.adjust(
      neuronsRef,
      (res.neurons ?? config.draftNeurons) - reserve,
    );
    return toDraft(mergeAiPairs(draft, type, res.pairs), 'ai');
  } catch (e) {
    // The model may have run: charge the estimate, keep the user's attempt.
    await deps.usage.adjust(neuronsRef, config.draftNeurons - reserve);
    deps.logger.warn('mapping draft: AI failed', {
      tid: ctx.tid,
      error: e instanceof Error ? e.name : 'unknown',
    });
    return toDraft(draft, 'rules');
  }
}
