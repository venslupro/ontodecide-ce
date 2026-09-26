/**
 * @fileoverview D1 repository for webhook replay protection
 * (int_webhook_nonce, keyed by signature).
 */

import type {NonceRepository} from '../application';
import {isUniqueViolation} from './d1_job_repository';

/** int_webhook_nonce over D1. */
export class D1NonceRepository implements NonceRepository {
  constructor(private readonly db: D1Database) {}

  async claim(
    signature: string,
    sourceId: string,
    ts: number,
  ): Promise<boolean> {
    try {
      await this.db
        .prepare(
          'INSERT INTO int_webhook_nonce (signature, source_id, ts) VALUES (?, ?, ?)',
        )
        .bind(signature, sourceId, ts)
        .run();
      return true;
    } catch (e) {
      if (isUniqueViolation(e)) return false;
      throw e;
    }
  }
}
