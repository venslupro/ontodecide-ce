/**
 * @fileoverview The subset of Durable Object `SqlStorage` used by the
 * cores; structurally satisfied by `ctx.storage.sql` and by the Node
 * `MemorySqlStorage` fake.
 */

/** Result cursor. */
export interface SqlCursorLike<T> extends Iterable<T> {
  toArray(): T[];
  one(): T;
  readonly rowsWritten: number;
}

/** Durable Object SQL storage. */
export interface SqlStorageLike {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): SqlCursorLike<T>;
}
