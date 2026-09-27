/**
 * @fileoverview Fake Workers AI binding (`env.AI`). Responses are scripted
 * per model; every call is recorded. Unscripted models throw, like a model
 * outage, so callers exercise their fallbacks.
 */

/** A recorded AI call. */
export interface AiCall {
  model: string;
  input: Record<string, unknown>;
}

/** Scripted response: a value or a function of the input. */
export type AiResponder =
  unknown | ((input: Record<string, unknown>) => unknown | Promise<unknown>);

/** Fake `Ai` binding. */
export class FakeWorkersAi {
  readonly calls: AiCall[] = [];
  private readonly scripts = new Map<string, AiResponder[]>();

  /** Queues responses for a model (the last one repeats). */
  script(model: string, ...responses: AiResponder[]): this {
    this.scripts.set(model, responses);
    return this;
  }

  async run(model: string, input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({model, input: structuredClone(input)});
    const queue = this.scripts.get(model);
    if (!queue || queue.length === 0) {
      throw new Error(`AI model unavailable: ${model}`);
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return typeof next === 'function'
      ? await (next as (i: Record<string, unknown>) => unknown)(input)
      : structuredClone(next);
  }

  /** Returns this as the Workers `Ai` type. */
  asAi(): Ai {
    return this as unknown as Ai;
  }
}
