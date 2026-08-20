/**
 * Prompt templates for the AI Service features.
 *
 * Centralising prompts here makes it easy to A/B test or localise them
 * later, and keeps the service handlers focused on plumbing.
 */
import type {ScenarioTone} from '@ontodecide/shared';

const SYSTEM_PROMPT = `You are OntoDecide, an analyst-grade decision-intelligence assistant.
Always respond in valid JSON when a structured output is requested. Never
invent facts — when you lack information, say so explicitly.`;

/** Build the user prompt for the scenario-simulation feature. */
export function scenarioPrompt(
    topic: string,
    context: string | undefined,
    tones: ScenarioTone[],
): string {
  const contextBlock = context ? `\n\nContext:\n${context}\n` : '';
  return `Topic: ${topic}${contextBlock}

Produce a multi-scenario analysis of the topic, covering each of the
following tones: ${tones.join(', ')}. For each tone provide:
  - tone: one of ${tones.map((t) => `"${t}"`).join(', ')}
  - narrative: a 3-5 sentence story
  - keyFactors: an array of 3-5 strings
  - probability: a 0..1 number

Respond as a JSON object with a "scenarios" array. Only JSON, no commentary.`;
}

/** Build the user prompt for the recommendation feature. */
export function recommendationPrompt(
    topic: string,
    history: string | undefined,
): string {
  const historyBlock = history ? `\n\nHistorical context:\n${history}\n` : '';
  return `Topic: ${topic}${historyBlock}

Generate a structured recommendation. The output must be a JSON object with:
  - priority: one of "low", "medium", "high", "critical"
  - confidence: a 0..1 number
  - rationale: a 2-4 sentence string
  - steps: an array of {order, action, expectedOutcome}

Only JSON, no commentary.`;
}

/** Build the user prompt for the planning agent's goal-decomposition step. */
export function planPrompt(goal: string): string {
  return `Goal: ${goal}

Decompose this goal into a maximum of 8 actionable tasks. Each task must
have a short description (less than 100 characters). Respond as a JSON
object with a "tasks" array of {id, description} objects. Only JSON.`;
}

/** Build the user prompt for the planning agent's reflection step. */
export function reflectPrompt(state: string): string {
  return `Agent state:\n${state}\n\nReflect on the executed tasks. Identify what
worked, what failed, and one concrete improvement for the next run. Reply
in 3-5 sentences.`;
}

export {SYSTEM_PROMPT};
