/**
 * @fileoverview A Cloudflare D1 emulation over node:sqlite for Node-based
 * integration tests. Supports prepare/bind/first/all/run/raw, batch() (as a
 * transaction) and exec(). Migrations are applied from SQL files.
 */

import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

type Value = string | number | bigint | null | Uint8Array;

function normalize(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint')
    return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return JSON.stringify(v);
}

function isReader(sql: string): boolean {
  return /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);
}

class Statement {
  constructor(
    private readonly db: SqliteD1,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, values.map(normalize));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.raw.prepare(this.sql).get(...this.params) as Record<
      string,
      unknown
    >;
    this.db.queries++;
    if (!row) return null;
    this.db.rowsRead++;
    return (column ? row[column] : {...row}) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.execute<T>();
  }

  async raw<T = unknown[]>(opts?: {columnNames?: boolean}): Promise<T[]> {
    const stmt = this.db.raw.prepare(this.sql);
    const rows = stmt.all(...this.params) as Record<string, unknown>[];
    const out = rows.map(r => Object.values(r)) as T[];
    if (opts?.columnNames) {
      const cols = stmt.columns().map(c => c.name);
      return [cols as unknown as T, ...out];
    }
    return out;
  }

  /** Executes synchronously (used by batch). */
  execute<T>(): D1Result<T> {
    const stmt = this.db.raw.prepare(this.sql);
    this.db.queries++;
    if (isReader(this.sql)) {
      const rows = (stmt.all(...this.params) as Record<string, unknown>[]).map(
        r => ({...r}),
      );
      this.db.rowsRead += rows.length;
      return {
        success: true,
        results: rows as T[],
        meta: {
          changes: 0,
          last_row_id: 0,
          rows_read: rows.length,
          rows_written: 0,
          duration: 0,
        },
      } as unknown as D1Result<T>;
    }
    const info = stmt.run(...this.params);
    const changes = Number(info.changes);
    this.db.rowsWritten += changes;
    return {
      success: true,
      results: [] as T[],
      meta: {
        changes,
        last_row_id: Number(info.lastInsertRowid),
        rows_read: 0,
        rows_written: changes,
        duration: 0,
      },
    } as unknown as D1Result<T>;
  }
}

/** D1Database-compatible wrapper around node:sqlite. */
export class SqliteD1 {
  readonly raw: DatabaseSync;
  queries = 0;
  rowsRead = 0;
  rowsWritten = 0;

  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path);
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  async batch<T = unknown>(statements: Statement[]): Promise<D1Result<T>[]> {
    this.raw.exec('BEGIN');
    try {
      const results = statements.map(s => s.execute<T>());
      this.raw.exec('COMMIT');
      return results;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql: string): Promise<{count: number; duration: number}> {
    this.raw.exec(sql);
    return {count: 1, duration: 0};
  }

  /** Applies every `*.sql` file in the directory, in name order. */
  migrate(dir: string): this {
    for (const file of readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .sort()) {
      this.raw.exec(readFileSync(join(dir, file), 'utf8'));
    }
    return this;
  }

  /** Returns this as the Workers D1Database type. */
  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

/** Repository root (packages/testing/../..). */
export const REPO_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Creates an in-memory D1 with the migrations of one database applied.
 * `db` is a directory under /migrations (identity, ontology, integration,
 * object, situation, decision).
 */
export function createTestD1(db: string): D1Database {
  return new SqliteD1().migrate(join(REPO_ROOT, 'migrations', db)).asD1();
}
