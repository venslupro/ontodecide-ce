/**
 * @fileoverview Durable Object SqlStorage emulation over node:sqlite.
 */

import {DatabaseSync} from 'node:sqlite';

/** Minimal SqlStorage cursor. */
export interface SqlCursor<T> extends Iterable<T> {
  toArray(): T[];
  one(): T;
  readonly rowsWritten: number;
}

/** Minimal SqlStorage (the subset used by our Durable Objects). */
export interface SqlStorageLike {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): SqlCursor<T>;
}

/** In-memory SqlStorage for Durable Object unit tests. */
export class MemorySqlStorage implements SqlStorageLike {
  private readonly db = new DatabaseSync(':memory:');

  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): SqlCursor<T> {
    const params = bindings.map(b =>
      b === undefined ? null : typeof b === 'boolean' ? (b ? 1 : 0) : b,
    ) as (string | number | null)[];
    const statements = query
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);
    let rows: T[] = [];
    let written = 0;
    for (const sql of statements) {
      const stmt = this.db.prepare(sql);
      if (
        /^\s*(select|with|pragma)\b/i.test(sql) ||
        /\breturning\b/i.test(sql)
      ) {
        rows = (
          stmt.all(...(statements.length === 1 ? params : [])) as T[]
        ).map(r => ({...r}));
      } else {
        written += Number(
          stmt.run(...(statements.length === 1 ? params : [])).changes,
        );
      }
    }
    return {
      toArray: () => rows,
      one: () => {
        if (rows.length !== 1)
          throw new Error(`Expected exactly one row, got ${rows.length}`);
        return rows[0];
      },
      rowsWritten: written,
      [Symbol.iterator]: () => rows[Symbol.iterator](),
    };
  }
}
