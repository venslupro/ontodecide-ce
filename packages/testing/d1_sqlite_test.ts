/**
 * @fileoverview Tests of the platform fakes: D1 over node:sqlite, QueueBus, rpcBinding, Workers AI, rate limiter.
 */

import {describe, expect, it} from 'vitest';
import {SqliteD1, createTestD1} from './d1_sqlite';
import {FakeRateLimiter} from './rate_limiter';
import {FakeWorkersAi} from './workers_ai';
import {QueueBus} from './memory_queue';
import {rpcBinding} from './rpc_binding';
import {AppError} from '@ontodecide/shared-kernel';

function scratch(): D1Database {
  const db = new SqliteD1();
  db.raw.exec(
    'CREATE TABLE idn_tenant (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER)',
  );
  return db.asD1();
}

describe('SqliteD1', () => {
  it('applies migrations and supports prepare/bind/first/all/batch', async () => {
    const db = scratch();
    await db.batch([
      db
        .prepare(
          'INSERT INTO idn_tenant (id, name, created_at) VALUES (?, ?, ?)',
        )
        .bind('t1', 'T', 1),
      db
        .prepare(
          'INSERT INTO idn_tenant (id, name, created_at) VALUES (?, ?, ?)',
        )
        .bind('t2', 'U', 2),
    ]);
    const row = await db
      .prepare('SELECT name FROM idn_tenant WHERE id = ?')
      .bind('t2')
      .first<{name: string}>();
    expect(row?.name).toBe('U');
    const {results} = await db
      .prepare('SELECT id FROM idn_tenant ORDER BY id')
      .all<{id: string}>();
    expect(results.map(r => r.id)).toEqual(['t1', 't2']);
    const res = await db
      .prepare('DELETE FROM idn_tenant WHERE id = ?')
      .bind('t1')
      .run();
    expect(res.meta.changes).toBe(1);
  });

  it('rolls back a failing batch', async () => {
    const db = scratch();
    const ins =
      'INSERT INTO idn_tenant (id, name, created_at) VALUES (?, ?, ?)';
    await expect(
      db.batch([
        db.prepare(ins).bind('a', 'A', 1),
        db.prepare(ins).bind('a', 'dup', 1),
      ]),
    ).rejects.toThrow();
    expect(
      await db.prepare('SELECT COUNT(*) AS n FROM idn_tenant').first('n'),
    ).toBe(0);
  });

  it('applies every migration directory', () => {
    for (const d of [
      'identity-access',
      'ontology-manager',
      'data-integration',
      'object-graph',
      'decision-engine',
    ]) {
      expect(() => createTestD1(d)).not.toThrow();
    }
  });

  it('counts index entries in rows_written like D1', async () => {
    const d1 = new SqliteD1();
    d1.raw.exec(
      'CREATE TABLE r (id TEXT PRIMARY KEY, a TEXT, b TEXT, UNIQUE (a)); ' +
        'CREATE INDEX ix_b ON r (b); ' +
        'CREATE TABLE w (t TEXT, k TEXT, v TEXT, PRIMARY KEY (t, k)) WITHOUT ROWID; ' +
        'CREATE INDEX ix_v ON w (t, v); ' +
        'CREATE TABLE p (id INTEGER PRIMARY KEY, x TEXT)',
    );
    const db = d1.asD1();
    const run = async (sql: string, ...b: unknown[]) =>
      (
        await db
          .prepare(sql)
          .bind(...b)
          .run()
      ).meta.rows_written;
    // rowid table: row + PK autoindex + UNIQUE autoindex + ix_b.
    expect(await run('INSERT INTO r VALUES (?, ?, ?)', '1', 'x', 'y')).toBe(4);
    // Only ix_b's column changes.
    expect(await run("UPDATE r SET b = 'z' WHERE id = '1'")).toBe(2);
    // No indexed column changes.
    expect(await run("UPDATE r SET b = 'z' WHERE id = '1'")).toBe(1);
    // WITHOUT ROWID: the primary key is the table; ix_v counts once.
    expect(await run("INSERT INTO w VALUES ('t', 'k', 'v')")).toBe(2);
    expect(await run("UPDATE w SET v = 'u'")).toBe(2);
    expect(await run('DELETE FROM w')).toBe(2);
    // INTEGER PRIMARY KEY is the rowid: no extra index.
    expect(await run("INSERT INTO p (x) VALUES ('a')")).toBe(1);
    // Nothing matched → nothing written; reads write nothing.
    expect(await run("DELETE FROM r WHERE id = 'none'")).toBe(0);
    expect((await db.prepare('SELECT * FROM r').all()).meta.rows_written).toBe(
      0,
    );
    // RETURNING writes are billed too.
    const ret = await db
      .prepare("INSERT INTO p (x) VALUES ('b') RETURNING id")
      .all();
    expect(ret.meta.rows_written).toBe(1);
    // Tables created later are metered as well.
    await db.exec('CREATE TABLE late (id TEXT PRIMARY KEY)');
    expect(await run("INSERT INTO late VALUES ('1')")).toBe(2);
    expect(d1.rowsWritten).toBe(4 + 2 + 1 + 2 + 2 + 2 + 1 + 1 + 2);
  });
});

describe('QueueBus', () => {
  it('retries failed messages and dead-letters after maxRetries', async () => {
    const bus = new QueueBus();
    await bus.sender('q').send({n: 1});
    let calls = 0;
    await bus.drain({
      q: {
        handler: async batch => {
          calls++;
          batch.messages.forEach(m => m.retry());
        },
        maxRetries: 2,
        deadLetterQueue: 'q-dlq',
      },
    });
    expect(calls).toBe(3);
    expect(bus.peek('q-dlq')).toEqual([{n: 1}]);
  });
});

describe('rpcBinding', () => {
  it('strips error properties but AppError survives via the message', async () => {
    const stub = rpcBinding({
      fail: async () => {
        throw new AppError('NOT_FOUND', 'nope');
      },
    });
    const err = await stub.fail().catch(e => e);
    expect(err).not.toBeInstanceOf(AppError);
    const recovered = AppError.from(err);
    expect(recovered.code).toBe('NOT_FOUND');
    expect(recovered.status).toBe(404);
  });
});

describe('FakeWorkersAi and FakeRateLimiter', () => {
  it('scripts model responses and simulates outages', async () => {
    const ai = new FakeWorkersAi().script(
      'm',
      {response: 'a'},
      {response: 'b'},
    );
    expect(await ai.run('m', {})).toEqual({response: 'a'});
    expect(await ai.run('m', {})).toEqual({response: 'b'});
    expect(await ai.run('m', {})).toEqual({response: 'b'});
    await expect(ai.run('other', {})).rejects.toThrow('unavailable');
    expect(ai.calls).toHaveLength(4);
  });

  it('limits per key', async () => {
    const rl = new FakeRateLimiter(2).asRateLimit();
    expect((await rl.limit({key: 'k'})).success).toBe(true);
    expect((await rl.limit({key: 'k'})).success).toBe(true);
    expect((await rl.limit({key: 'k'})).success).toBe(false);
    expect((await rl.limit({key: 'j'})).success).toBe(true);
  });
});
