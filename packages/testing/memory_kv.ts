/**
 * @fileoverview In-memory KVNamespace for tests.
 */

/** KVNamespace-compatible in-memory store. */
export class MemoryKV {
  readonly data = new Map<string, {value: string; expiresAt?: number}>();
  writes = 0;

  async get(
    key: string,
    type?: 'text' | 'json' | {type: 'text' | 'json'},
  ): Promise<unknown> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.data.delete(key);
      return null;
    }
    const t = typeof type === 'object' ? type.type : type;
    return t === 'json' ? JSON.parse(entry.value) : entry.value;
  }

  async put(
    key: string,
    value: string,
    opts?: {expirationTtl?: number},
  ): Promise<void> {
    this.writes++;
    this.data.set(key, {
      value,
      expiresAt: opts?.expirationTtl
        ? Date.now() + opts.expirationTtl * 1000
        : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(
    opts: {prefix?: string} = {},
  ): Promise<{keys: {name: string}[]; list_complete: true}> {
    const keys = [...this.data.keys()]
      .filter(k => !opts.prefix || k.startsWith(opts.prefix))
      .map(name => ({name}));
    return {keys, list_complete: true};
  }

  /** Returns this as the Workers KVNamespace type. */
  asKV(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}
