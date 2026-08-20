/**
 * Scenario-simulation service.
 *
 * Implements the design doc §4.5.4 "情景推演" feature:
 *   - high temperature (0.8) for creative breadth;
 *   - optimistic / pessimistic / neutral tone set;
 *   - results cached for 1h in KV so repeat requests are free.
 *
 * The service depends on:
 *   - an {@link ILLMProvider} (resolved via {@link ProviderFactory});
 *   - the {@link NeuronBudgetManager} for free-tier protection;
 *   - the {@link IDecisionRepository} for persistence + cache lookup.
 */
import {
  CACHE_KEYS,
  CACHE_TTL,
  type LlmOptions,
  type LlmProvider,
  type ScenarioResult,
  type ScenarioTone,
  dayKey,
  nowIso,
  sha256Hex,
  throwError,
  uuid,
  ERROR_CODES,
} from '@ontodecide/shared';
import {SYSTEM_PROMPT, scenarioPrompt} from '../core/scenarios/prompts.js';
import type {ILLMProvider} from '../core/llm/provider.interface.js';
import type {NeuronBudgetManager} from '../core/budget.service.js';
import type {IDecisionRepository} from '../repository/decision.repository.js';

export interface ScenarioRequest {
  tenantId: string;
  topic: string;
  context?: string;
  tones?: ScenarioTone[];
  provider?: LlmProvider;
}

export class ScenarioService {
  constructor(
    private readonly budgets: NeuronBudgetManager,
    private readonly decisions: IDecisionRepository,
    private readonly cache: KVNamespace,
  ) {}

  public async simulate(
      request: ScenarioRequest,
      resolveProvider: (id?: LlmProvider) => ILLMProvider,
  ): Promise<ScenarioResult> {
    const tones = request.tones ?? ['optimistic', 'pessimistic', 'neutral'];
    const prompt = scenarioPrompt(request.topic, request.context, tones);
    const hash = await sha256Hex(`${request.tenantId}:${prompt}`);

    // 1. KV cache hit?
    const cacheKey = CACHE_KEYS.scenario(request.tenantId, hash);
    const cached = await this.cache.get<ScenarioResult>(cacheKey, 'json');
    if (cached) return cached;

    // 2. D1 cache hit (older than 1h but within 24h)?
    const past = await this.decisions.findByHash(request.tenantId, hash);
    if (past) {
      const pastResult = JSON.parse(past.payload) as ScenarioResult;
      await this.cache.put(cacheKey, JSON.stringify(pastResult), {
        expirationTtl: CACHE_TTL.SITUATION_HOT,
      });
      return pastResult;
    }

    // 3. Live LLM call, gated by the neuron budget.
    const provider = resolveProvider(request.provider);
    const estimatedNeurons = provider.estimateNeurons(prompt);
    const options: LlmOptions = {
      temperature: 0.8,
      maxTokens: 2048,
      systemPrompt: SYSTEM_PROMPT,
    };

    const result = await this.budgets.executeWithBudget<ScenarioResult>(
        estimatedNeurons,
        async () => {
          const response = await provider.generate(prompt, options);
          const scenarios = parseScenarios(response.content, tones);
          const scenario: ScenarioResult = {
            tenant_id: request.tenantId,
            topic: request.topic,
            scenarios,
            generatedAt: nowIso(),
            provider: response.provider,
          };
          // Persist for history + future cache hits.
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
          return {result: scenario, actualCost: response.usage.totalTokens};
        },
        async () => this.ruleBasedFallback(request, tones),
    );

    await this.cache.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CACHE_TTL.SCENARIO,
    });
    return result;
  }

  /**
   * Rule-based fallback when the Neuron budget is exhausted.
   *
   * Produces a deterministic three-tone outline so the dashboard keeps
   * working even without LLM access.
   */
  private async ruleBasedFallback(
      request: ScenarioRequest,
      tones: ScenarioTone[],
  ): Promise<ScenarioResult> {
    return {
      tenant_id: request.tenantId,
      topic: request.topic,
      scenarios: tones.map((tone) => ({
        tone,
        narrative:
          `Budget-restricted ${tone} outline for "${request.topic}". ` +
          'Upgrade the plan or wait until tomorrow for full LLM analysis.',
        keyFactors: ['budget-limit', dayKey()],
        probability: tone === 'neutral' ? 0.5 : tone === 'optimistic' ? 0.7 : 0.3,
      })),
      generatedAt: nowIso(),
      provider: 'rule-based' as unknown as LlmProvider,
    };
  }
}

/** Parse the LLM response into the typed scenarios array. */
function parseScenarios(content: string, expectedTones: ScenarioTone[]): Array<{
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
  const arr = (parsed as {scenarios?: unknown[]})?.scenarios ?? parsed;
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
