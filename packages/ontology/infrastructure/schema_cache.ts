/**
 * @fileoverview Two-tier compiled schema / model cache: an isolate-memory
 * LRU (keys `{tenant}:{api}:{version}` and `{tenant}:model`) in front of KV
 * (`schema:{tenant}:{api}:current`, `model:{tenant}`). KV is written only on
 * publish because the free tier allows 1,000 writes per day.
 */

import type {Clock, Logger} from '@ontodecide/shared-kernel';
import type {SchemaCache} from '../application';
import type {CompiledModel, CompiledSchema} from '../contract';

/** Default time-to-live of mutable (current / model) memory entries. */
export const MEMORY_TTL_MS = 30_000;

/** A small LRU with optional per-entry expiry. */
export class LruCache<V> {
  private readonly map = new Map<string, {value: V; expiresAt: number}>();

  constructor(
    private readonly clock: Clock,
    private readonly capacity = 256,
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock.now().getTime()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Stores a value; `ttlMs` omitted means no expiry. */
  set(key: string, value: V, ttlMs?: number): void {
    this.map.delete(key);
    const expiresAt =
      ttlMs === undefined
        ? Number.POSITIVE_INFINITY
        : this.clock.now().getTime() + ttlMs;
    this.map.set(key, {value, expiresAt});
    while (this.map.size > this.capacity) {
      this.map.delete(this.map.keys().next().value as string);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

/** KV key of a tenant's current compiled schema. */
export function schemaKvKey(tenantId: string, api: string): string {
  return `schema:${tenantId}:${api}:current`;
}

/** KV key of a tenant's active model. */
export function modelKvKey(tenantId: string): string {
  return `model:${tenantId}`;
}

/** Memory + KV implementation of {@link SchemaCache}. */
export class TieredSchemaCache implements SchemaCache {
  private readonly memory: LruCache<CompiledSchema | CompiledModel>;

  constructor(
    private readonly kv: KVNamespace,
    clock: Clock,
    private readonly logger: Logger,
    private readonly ttlMs = MEMORY_TTL_MS,
    capacity = 256,
  ) {
    this.memory = new LruCache(clock, capacity);
  }

  async getSchema(
    tenantId: string,
    api: string,
    version: string,
  ): Promise<CompiledSchema | null> {
    const key = `${tenantId}:${api}:${version}`;
    const hit = this.memory.get(key) as CompiledSchema | undefined;
    if (hit) return hit;
    if (version !== 'current') return null;
    const fromKv = await this.readKv<CompiledSchema>(
      schemaKvKey(tenantId, api),
    );
    if (fromKv) this.memory.set(key, fromKv, this.ttlMs);
    return fromKv;
  }

  putSchema(tenantId: string, version: string, schema: CompiledSchema): void {
    // Published versions are immutable; only `current` can go stale.
    this.memory.set(
      `${tenantId}:${schema.apiName}:${version}`,
      schema,
      version === 'current' ? this.ttlMs : undefined,
    );
  }

  async getModel(tenantId: string): Promise<CompiledModel | null> {
    const key = `${tenantId}:model`;
    const hit = this.memory.get(key) as CompiledModel | undefined;
    if (hit) return hit;
    const fromKv = await this.readKv<CompiledModel>(modelKvKey(tenantId));
    if (fromKv) this.memory.set(key, fromKv, this.ttlMs);
    return fromKv;
  }

  putModel(tenantId: string, model: CompiledModel): void {
    this.memory.set(`${tenantId}:model`, model, this.ttlMs);
  }

  async onPublish(
    tenantId: string,
    schema: CompiledSchema,
    model: CompiledModel,
  ): Promise<void> {
    this.putSchema(tenantId, 'current', schema);
    this.putSchema(tenantId, schema.version, schema);
    this.putModel(tenantId, model);
    await Promise.all([
      this.kv.put(
        schemaKvKey(tenantId, schema.apiName),
        JSON.stringify(schema),
      ),
      this.kv.put(modelKvKey(tenantId), JSON.stringify(model)),
    ]);
  }

  private async readKv<T>(key: string): Promise<T | null> {
    try {
      return ((await this.kv.get(key, 'json')) as T | null) ?? null;
    } catch (e) {
      this.logger.warn('ontology.kv_read_failed', {
        key,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }
}
