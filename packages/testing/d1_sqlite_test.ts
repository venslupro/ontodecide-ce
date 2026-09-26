import {describe, expect, it} from 'vitest';
import {createTestD1} from './d1_sqlite';
import {QueueBus} from './memory_queue';
import {rpcBinding} from './rpc_binding';
import {AppError} from '@ontodecide/shared-kernel';

describe('SqliteD1', () => {
  it('applies migrations and supports prepare/bind/first/all/batch', async () => {
    const db = createTestD1('identity');
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
    const db = createTestD1('identity');
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
      'identity',
      'ontology',
      'integration',
      'object',
      'situation',
      'decision',
    ]) {
      expect(() => createTestD1(d)).not.toThrow();
    }
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
        throw new AppError('OBJECT_NOT_FOUND', 'nope');
      },
    });
    const err = await stub.fail().catch(e => e);
    expect(err).not.toBeInstanceOf(AppError);
    const recovered = AppError.from(err);
    expect(recovered.code).toBe('OBJECT_NOT_FOUND');
    expect(recovered.status).toBe(404);
  });
});
