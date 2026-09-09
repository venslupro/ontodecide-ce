/**
 * Recommendation service: low-temperature, history-aware suggestions.
 *
 * Mirrors the design doc §4.5.4 "Decision Recommendation" feature:
 *   - low temperature (0.3) for deterministic output;
 *   - history reference (last 10 decisions for the tenant);
 *   - structured output with priority / confidence / steps.
 *
 * Caching and budget management are delegated to the Cloudflare AI
 * Gateway; the service calls the provider directly and persists the
 * result to D1 for dashboard history.
 */
import {
  ERROR_CODES,
  type LlmOptions,
  type LlmProvider,
  type Recommendation,
  nowIso,
  sha256Hex,
  throwError,
  uuid,
} from '@ontodecide/shared';
import { SYSTEM_PROMPT, recommendationPrompt } from '../core/scenarios/prompts.js';
import type { ILLMProvider } from '../core/llm/provider.interface.js';
import type { IDecisionRepository } from '../repository/decision.repository.js';

export interface RecommendationRequest {
  tenantId: string;
  topic: string;
  history?: string;
  provider?: LlmProvider;
}

export class RecommendationService {
  constructor(private readonly decisions: IDecisionRepository) {}

  public async recommend(
    request: RecommendationRequest,
    resolveProvider: (id?: LlmProvider) => ILLMProvider,
  ): Promise<Recommendation> {
    const history = request.history ?? (await this.loadHistory(request.tenantId));
    const prompt = recommendationPrompt(request.topic, history);
    const hash = await sha256Hex(`rec:${request.tenantId}:${prompt}`);

    const provider = resolveProvider(request.provider);
    const options: LlmOptions = {
      temperature: 0.3,
      maxTokens: 1024,
      systemPrompt: SYSTEM_PROMPT,
    };

    const response = await provider.generate(prompt, options);
    const parsed = parseRecommendation(response.content);
    const rec: Recommendation = {
      id: uuid(),
      tenant_id: request.tenantId,
      topic: request.topic,
      priority: parsed.priority,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      steps: parsed.steps,
      generatedAt: nowIso(),
      provider: response.provider,
    };

    await this.decisions.save({
      id: uuid(),
      tenantId: request.tenantId,
      kind: 'recommendation',
      topic: request.topic,
      provider: response.provider,
      model: response.model,
      promptHash: hash,
      payload: JSON.stringify(rec),
      neuronCost: response.usage.totalTokens,
      metadata: null,
    });

    return rec;
  }

  /** Load the 10 most recent decision summaries as history context. */
  private async loadHistory(tenantId: string): Promise<string> {
    const { items } = await this.decisions.listForTenant(tenantId, { limit: 10 });
    if (items.length === 0) return '';
    return items
      .map((item) => `- [${item.kind}] ${item.topic}: ${item.payload.slice(0, 200)}`)
      .join('\n');
  }
}

interface ParsedRecommendation {
  priority: Recommendation['priority'];
  confidence: number;
  rationale: string;
  steps: Recommendation['steps'];
}

function parseRecommendation(content: string): ParsedRecommendation {
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
  const obj = parsed as Partial<ParsedRecommendation>;
  return {
    priority: obj.priority ?? 'medium',
    confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
    rationale: obj.rationale ?? '',
    steps: Array.isArray(obj.steps) ? obj.steps : [],
  };
}
