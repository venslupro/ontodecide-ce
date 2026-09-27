/**
 * @fileoverview Minimal structural type of Durable Object SQL storage
 * (`ctx.storage.sql`), so the store runs over the real runtime and over
 * `MemorySqlStorage` in Node tests.
 */

/** Cursor returned by {@link SqlStorageLike.exec}. */
export interface SqlCursorLike<T> extends Iterable<T> {
  toArray(): T[];
  one(): T;
  readonly rowsWritten: number;
}

/** The subset of SqlStorage used by the SituationRoom. */
export interface SqlStorageLike {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): SqlCursorLike<T>;
}
