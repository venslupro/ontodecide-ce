/**
 * @fileoverview EdgeGuard logic over Durable Object SQLite storage:
 * idempotency records and precise token buckets for write routes. The
 * Durable Object wrapper (edge_guard.ts) only delegates.
 */

import {DAY_MS} from '@ontodecide/shared-kernel';
import {takeToken, type TakeResult} from './rate_limiter';

/** Minimal SqlStorage surface (matches DurableObjectStorage.sql). */
export interface SqlStorageLike {
  exec<T = Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): {toArray(): T[]};
}

/** Stored idempotent response. */
export interface IdempotentRecord {
  status: number;
  body: string;
  createdAt: number;
}

/** RPC surface of the EdgeGuard Durable Object. */
export interface EdgeGuardRpc {
  getIdempotent(key: string): Promise<IdempotentRecord | null>;
  putIdempotent(key: string, status: number, body: string): Promise<void>;
  take(
    bucket: string,
    capacity: number,
    refillPerSec: number,
    now?: number,
  ): Promise<TakeResult>;
}

/** Idempotency record lifetime. */
export const IDEMPOTENCY_TTL_MS = DAY_MS;

/** EdgeGuard core over SQL storage. */
export class EdgeGuardCore {
  constructor(
    private readonly sql: SqlStorageLike,
    private readonly now: () => number = Date.now,
  ) {
    sql.exec(
      'CREATE TABLE IF NOT EXISTS idem (key TEXT PRIMARY KEY, status INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS rate (bucket TEXT PRIMARY KEY, tokens REAL NOT NULL, updated_at INTEGER NOT NULL)',
    );
  }

  /** Returns a stored response younger than 24 h, or null. */
  getIdempotent(key: string): IdempotentRecord | null {
    const rows = this.sql
      .exec<{
        status: number;
        body: string;
        created_at: number;
      }>('SELECT status, body, created_at FROM idem WHERE key = ?', key)
      .toArray();
    const row = rows[0];
    if (!row) return null;
    if (this.now() - Number(row.created_at) > IDEMPOTENCY_TTL_MS) return null;
    return {
      status: Number(row.status),
      body: String(row.body),
      createdAt: Number(row.created_at),
    };
  }

  /** Stores a response (first writer wins within the TTL). */
  putIdempotent(key: string, status: number, body: string): void {
    this.sql.exec(
      'INSERT INTO idem (key, status, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING',
      key,
      status,
      body,
      this.now(),
    );
  }

  /** Takes one token from a bucket. */
  take(
    bucket: string,
    capacity: number,
    refillPerSec: number,
    now: number = this.now(),
  ): TakeResult {
    const row = this.sql
      .exec<{
        tokens: number;
        updated_at: number;
      }>('SELECT tokens, updated_at FROM rate WHERE bucket = ?', bucket)
      .toArray()[0];
    const {state, result} = takeToken(
      row
        ? {tokens: Number(row.tokens), updatedAt: Number(row.updated_at)}
        : undefined,
      {capacity, refillPerSec},
      now,
    );
    this.sql.exec(
      'INSERT INTO rate (bucket, tokens, updated_at) VALUES (?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at',
      bucket,
      state.tokens,
      state.updatedAt,
    );
    return result;
  }

  /** Deletes idempotency records and idle buckets older than 24 h. */
  cleanup(now: number = this.now()): void {
    const cutoff = now - IDEMPOTENCY_TTL_MS;
    this.sql.exec('DELETE FROM idem WHERE created_at < ?', cutoff);
    this.sql.exec('DELETE FROM rate WHERE updated_at < ?', cutoff);
  }
}
