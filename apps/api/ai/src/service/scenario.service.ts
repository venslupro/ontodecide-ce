/**
 * Scenario-simulation service.
 *
 * Implements the design doc §4.5.4 "Scenario Simulation" feature:
 *   - high temperature (0.8) for creative breadth;
 *   - optimistic / pessimistic / neutral tone set.
 *
 * Caching and budget management are delegated to the Cloudflare AI
 * Gateway; the service calls the provider directly and persists the
 * result to D1 for dashboard history.
 */
import {
  ERROR_CODES,
  type LlmOptions,
  type LlmProvider,
  type ScenarioResult,
  type ScenarioTone,
  nowIso,
  sha256Hex,
  throwError,
  uuid,
} from '@ontodecide/shared';
import { SYSTEM_PROMPT, scenarioPrompt } from '../core/scenarios/prompts.js';
import type { ILLMProvider } from '../core/llm/provider.interface.js';
import type { IDecisionRepository } from '../repository/decision.repository.js';

export interface ScenarioRequest {
  tenantId: string;
  topic: string;
  context?: string;
  tones?: ScenarioTone[];
  provider?: LlmProvider;
}

export class ScenarioService {
  constructor(private readonly decisions: IDecisionRepository) {}

  public async simulate(
    request: ScenarioRequest,
    resolveProvider: (id?: LlmProvider) => ILLMProvider,
  ): Promise<ScenarioResult> {
    const tones = request.tones ?? ['optimistic', 'pessimistic', 'neutral'];
    const prompt = scenarioPrompt(request.topic, request.context, tones);
    const hash = await sha256Hex(`${request.tenantId}:${prompt}`);

    const provider = resolveProvider(request.provider);
    const options: LlmOptions = {
      temperature: 0.8,
      maxTokens: 2048,
      systemPrompt: SYSTEM_PROMPT,
    };

    const response = await provider.generate(prompt, options);
    const scenarios = parseScenarios(response.content, tones);
    const scenario: ScenarioResult = {
      tenant_id: request.tenantId,
      topic: request.topic,
      scenarios,
      generatedAt: nowIso(),
      provider: response.provider,
    };

    await this.decisions.save({
      id: uuid(),
      tenantId: request.tenantId,
      kind: 'scenario',
      topic: request.topic,
      provider: response.provider,
      model: response.model,
      promptHash: hash,
      payload: JSON.stringify(scenario),
      neuronCost: response.usage.totalTokens,
      metadata: null,
    });

    return scenario;
  }
}

/** Parse the LLM response into the typed scenarios array. */
function parseScenarios(
  content: string,
  expectedTones: ScenarioTone[],
): Array<{
  tone: ScenarioTone;
  narrative: string;
  keyFactors: string[];
  probability: number;
}> {
  // Strip code fences if the model wrapped the JSON in ```json ... ```.
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throwError(
      ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
      `LLM response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const arr = (parsed as { scenarios?: unknown[] })?.scenarios ?? parsed;
  if (!Array.isArray(arr)) {
    throwError(ERROR_CODES.AI_PROVIDER_UNAVAILABLE, 'LLM response had no scenarios array.');
  }
  return arr.map((entry, idx) => {
    const obj = entry as {
      tone?: string;
      narrative?: string;
      keyFactors?: string[];
      probability?: number;
    };
    return {
      tone: (obj.tone as ScenarioTone) ?? expectedTones[idx] ?? 'neutral',
      narrative: typeof obj.narrative === 'string' ? obj.narrative : '',
      keyFactors: Array.isArray(obj.keyFactors) ? obj.keyFactors.map(String) : [],
      probability: typeof obj.probability === 'number' ? obj.probability : 0.5,
    };
  });
}
