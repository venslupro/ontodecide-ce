/**
 * @fileoverview A Cloudflare D1 emulation over node:sqlite for Node-based
 * integration tests. Supports prepare/bind/first/all/run/raw, batch() (as a
 * transaction) and exec(). Migrations are applied from SQL files.
 *
 * `meta.rows_written` models D1's billing, where every index entry a write
 * touches counts as one more row written (修订说明书 12.4; 详细设计 表 14):
 * TEMP triggers on every table add 1 + the number of affected indexes per
 * inserted / deleted row, and 1 + the indexes whose key or auxiliary columns
 * changed per updated row. A WITHOUT ROWID table's primary key is the table
 * itself and is not counted twice; a rowid table's non-INTEGER primary key
 * and UNIQUE constraints are separate indexes and are. Partial indexes are
 * counted as if their WHERE always held (a conservative over-estimate). The
 * triggers are (re)installed whenever the main schema changes; they write to
 * a TEMP table, so they neither show up in the schema nor in `changes`.
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

/** Name of the TEMP counter table the write meter triggers update. */
const METER = 'od_write_meter';

function q(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Index of a table as the write meter sees it. */
interface MeteredIndex {
  /** Column names in the index entry; null when an expression is indexed. */
  columns: string[] | null;
}

function meteredIndexes(db: DatabaseSync, table: string): MeteredIndex[] {
  const withoutRowid =
    (
      db.prepare(`PRAGMA main.table_list(${q(table)})`).get() as
        {wr: number} | undefined
    )?.wr === 1;
  const out: MeteredIndex[] = [];
  const list = db.prepare(`PRAGMA main.index_list(${q(table)})`).all() as {
    name: string;
    origin: string;
  }[];
  for (const ix of list) {
    if (withoutRowid && ix.origin === 'pk') continue;
    const cols = db.prepare(`PRAGMA main.index_xinfo(${q(ix.name)})`).all() as {
      cid: number;
      name: string | null;
    }[];
    const named: string[] = [];
    let expression = false;
    for (const c of cols) {
      if (c.cid === -1) continue; // rowid: never changes on UPDATE.
      if (c.cid === -2 || c.name === null) expression = true;
      else named.push(c.name);
    }
    out.push({columns: expression ? null : named});
  }
  return out;
}

/** (Re)creates the TEMP write-meter triggers for every main table. */
function installWriteMeter(db: DatabaseSync): void {
  db.exec(
    `CREATE TEMP TABLE IF NOT EXISTS ${METER} (n INTEGER NOT NULL); ` +
      `INSERT INTO ${METER} SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM ${METER})`,
  );
  const old = db
    .prepare(
      "SELECT name FROM temp.sqlite_master WHERE type = 'trigger' AND name LIKE 'od_wm_%'",
    )
    .all() as {name: string}[];
  for (const t of old) db.exec(`DROP TRIGGER temp.${q(t.name)}`);
  const tables = db
    .prepare(
      "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as {name: string}[];
  tables.forEach(({name}, i) => {
    const idx = meteredIndexes(db, name);
    const whole = 1 + idx.length;
    const changed = idx.map(ix =>
      ix.columns === null || ix.columns.length === 0
        ? '1'
        : `(CASE WHEN ${ix.columns
            .map(c => `OLD.${q(c)} IS NOT NEW.${q(c)}`)
            .join(' OR ')} THEN 1 ELSE 0 END)`,
    );
    const on = `ON main.${q(name)} BEGIN UPDATE ${METER} SET n = n +`;
    db.exec(
      `CREATE TEMP TRIGGER od_wm_i${i} AFTER INSERT ${on} ${whole}; END; ` +
        `CREATE TEMP TRIGGER od_wm_d${i} AFTER DELETE ${on} ${whole}; END; ` +
        `CREATE TEMP TRIGGER od_wm_u${i} AFTER UPDATE ${on} ${['1', ...changed].join(' + ')}; END;`,
    );
  });
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
    const row = this.db.metered(
      () =>
        this.db.raw.prepare(this.sql).get(...this.params) as
          Record<string, unknown> | undefined,
    ).value;
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
    const rows = this.db.metered(
      () => stmt.all(...this.params) as Record<string, unknown>[],
    ).value;
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
      const {value, written} = this.db.metered(() =>
        (stmt.all(...this.params) as Record<string, unknown>[]).map(r => ({
          ...r,
        })),
      );
      this.db.rowsRead += value.length;
      return {
        success: true,
        results: value as T[],
        meta: {
          changes: written > 0 ? value.length : 0,
          last_row_id: 0,
          rows_read: value.length,
          rows_written: written,
          duration: 0,
        },
      } as unknown as D1Result<T>;
    }
    const {value: info, written} = this.db.metered(() =>
      stmt.run(...this.params),
    );
    const changes = Number(info.changes);
    return {
      success: true,
      results: [] as T[],
      meta: {
        changes,
        last_row_id: Number(info.lastInsertRowid),
        rows_read: 0,
        rows_written: Math.max(written, changes),
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
  /** Rows written as D1 bills them (index entries included). */
  rowsWritten = 0;
  /**
   * Wall time (ms) spent inside SQLite. In production this is D1 query time
   * spent outside the Worker, so CPU budget tests subtract it.
   */
  busyMs = 0;
  private meteredSchema = -1;

  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path);
    // D1 always enforces foreign keys.
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  /**
   * Runs `fn` and returns what it wrote per the write meter (see the file
   * overview); adds it to {@link rowsWritten}.
   */
  metered<V>(fn: () => V): {value: V; written: number} {
    const version = (
      this.raw.prepare('PRAGMA main.schema_version').get() as {
        schema_version: number;
      }
    ).schema_version;
    if (version !== this.meteredSchema) {
      installWriteMeter(this.raw);
      this.meteredSchema = version;
    }
    const read = () =>
      (this.raw.prepare(`SELECT n FROM temp.${METER}`).get() as {n: number}).n;
    const before = read();
    const t0 = performance.now();
    let value: V;
    try {
      value = fn();
    } finally {
      this.busyMs += performance.now() - t0;
    }
    const written = read() - before;
    const changes =
      value && typeof value === 'object' && 'changes' in value
        ? Number((value as {changes: number | bigint}).changes)
        : 0;
    this.rowsWritten += Math.max(written, changes);
    return {value, written: Math.max(written, changes)};
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  async batch<T = unknown>(statements: Statement[]): Promise<D1Result<T>[]> {
    const written = this.rowsWritten;
    this.raw.exec('BEGIN');
    try {
      const results = statements.map(s => s.execute<T>());
      this.raw.exec('COMMIT');
      return results;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      // A failed batch is rolled back as a whole: nothing was written.
      this.rowsWritten = written;
      // The rollback may also have undone a meter installed inside it.
      this.meteredSchema = -1;
      throw e;
    }
  }

  async exec(sql: string): Promise<{count: number; duration: number}> {
    this.metered(() => this.raw.exec(sql));
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
 * `db` is a directory under /migrations (identity-access, ontology-manager,
 * data-integration, object-graph, decision-engine).
 */
export function createTestD1(db: string): D1Database {
  return new SqliteD1().migrate(join(REPO_ROOT, 'migrations', db)).asD1();
}
