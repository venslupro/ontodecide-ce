/**
 * PlanningAgent — autonomous agent backed by a Durable Object.
 *
 * Lifecycle (see design doc §4.5.5):
 *   1. `plan(goal)`    — call the LLM to decompose the goal into tasks.
 *   2. `execute()`     — iterate the task list; each task produces a
 *                         sub-result via a synchronous LLM call.
 *   3. `reflect()`     — once all tasks complete, summarise the run.
 *
 * State is persisted via `ctx.storage` so a crashed invocation resumes.
 * The agent uses the {@link ProviderFactory} so the underlying LLM is
 * swappable without touching the agent logic (open/closed principle).
 */
import {
  ERROR_CODES,
  type AgentState,
  type AgentTask,
  type LlmOptions,
  nowIso,
  throwError,
  uuid,
} from '@ontodecide/shared';
import { planPrompt, reflectPrompt, SYSTEM_PROMPT } from '../scenarios/prompts.js';
import type { AiEnv } from '../../types/env.js';
import { ProviderFactory } from '../llm/provider.factory.js';

type StorageState = AgentState;

interface AgentRequest {
  goal: string;
  provider?: string;
}

const STORAGE_KEY = 'state';

export class PlanningAgent {
  private state: StorageState | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: AiEnv,
  ) {}

  /** HTTP entry: callers `fetch` the agent to start a new run. */
  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/start' && request.method === 'POST') {
      const body = (await request.json()) as AgentRequest;
      await this.plan(body.goal);
      return jsonResponse({ state: this.state });
    }
    if (url.pathname === '/state' && request.method === 'GET') {
      this.state = await this.loadState();
      return jsonResponse({ state: this.state });
    }
    if (url.pathname === '/reflect' && request.method === 'POST') {
      await this.reflect();
      return jsonResponse({ state: this.state });
    }
    return new Response('Not Found', { status: 404 });
  }

  /** Decompose the goal into tasks. */
  public async plan(goal: string): Promise<void> {
    const factory = new ProviderFactory(this.env);
    const provider = factory.get();
    const prompt = planPrompt(goal);
    const options: LlmOptions = {
      temperature: 0.2,
      maxTokens: 1024,
      systemPrompt: SYSTEM_PROMPT,
    };
    const response = await provider.generate(prompt, options);
    const tasks = parseTasks(response.content);
    this.state = {
      goal,
      tasks,
      status: 'executing',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.persist();
    // Execute synchronously: tasks here are LLM-only (no IO); doing them
    // inline keeps the DO state machine simple. For IO-bound tasks, push
    // them to a queue and update state from the consumer.
    await this.executeTasks(provider, options);
  }

  /** Execute each planned task via the LLM. */
  private async executeTasks(
    provider: ReturnType<ProviderFactory['get']>,
    options: LlmOptions,
  ): Promise<void> {
    if (!this.state) return;
    for (const task of this.state.tasks) {
      if (task.status === 'succeeded' || task.status === 'skipped') continue;
      task.status = 'in_progress';
      task.startedAt = nowIso();
      this.state.updatedAt = nowIso();
      try {
        const response = await provider.generate(
          `Goal: ${this.state.goal}\nTask: ${task.description}`,
          { ...options, temperature: 0.4, maxTokens: 512 },
        );
        task.result = response.content;
        task.status = 'succeeded';
      } catch (err) {
        task.result = err instanceof Error ? err.message : String(err);
        task.status = 'failed';
      }
      task.finishedAt = nowIso();
      this.state.updatedAt = nowIso();
      await this.persist();
    }
    this.state.status = 'reflecting';
    await this.persist();
  }

  /** Summarise the run and mark it done. */
  public async reflect(): Promise<void> {
    if (!this.state) {
      throwError(ERROR_CODES.AI_AGENT_INACTIVE, 'Agent has no active state.');
    }
    const factory = new ProviderFactory(this.env);
    const provider = factory.get();
    const prompt = reflectPrompt(JSON.stringify(this.state));
    const response = await provider.generate(prompt, {
      temperature: 0.4,
      maxTokens: 512,
      systemPrompt: SYSTEM_PROMPT,
    });
    // Persist the reflection as a synthetic final task.
    this.state.tasks.push({
      id: uuid(),
      description: 'Reflection',
      status: 'succeeded',
      result: response.content,
      finishedAt: nowIso(),
    });
    this.state.status = 'done';
    this.state.updatedAt = nowIso();
    await this.persist();
    // Also persist a row in D1 for dashboard history.
    await this.env.DB.prepare(
      `INSERT INTO agent_runs
             (id, tenant_id, goal, status, task_count,
              completed_count, provider, finished_at, result)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        uuid(),
        'agent', // tenant_id is set by the caller via headers when the DO is invoked; for now 'agent' is a placeholder
        this.state.goal,
        this.state.status,
        this.state.tasks.length,
        this.state.tasks.filter((t) => t.status === 'succeeded').length,
        provider.id,
        nowIso(),
        response.content,
      )
      .run();
  }

  /** Load state from durable storage (cached on the instance). */
  private async loadState(): Promise<StorageState> {
    if (this.state) return this.state;
    const stored = await this.ctx.storage.get<StorageState>(STORAGE_KEY);
    this.state = stored ?? {
      goal: '',
      tasks: [],
      status: 'idle',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return this.state;
  }

  /** Persist state to durable storage. */
  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put(STORAGE_KEY, this.state);
  }
}

/** Parse the LLM's task list into typed AgentTask[]. */
function parseTasks(content: string): AgentTask[] {
  const cleaned = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const arr = (parsed as { tasks?: unknown[] })?.tasks ?? parsed;
  if (!Array.isArray(arr)) return [];
  return arr.map((entry, idx) => {
    const obj = entry as { id?: string; description?: string };
    return {
      id: typeof obj.id === 'string' ? obj.id : uuid(),
      description: typeof obj.description === 'string' ? obj.description : `Task ${idx + 1}`,
      status: 'pending',
    } satisfies AgentTask;
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
