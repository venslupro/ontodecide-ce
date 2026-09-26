/**
 * @fileoverview Append-only audit log in `idn_audit`. Entries never carry
 * passwords or tokens.
 */

import {ulid, type Clock} from '@ontodecide/shared-kernel';
import type {AuditEntry, AuditLog} from '../application';

/** Audit log in D1. */
export class D1AuditLog implements AuditLog {
  constructor(
    private readonly db: D1Database,
    private readonly clock: Clock,
  ) {}

  async record(e: AuditEntry): Promise<void> {
    const now = this.clock.now().getTime();
    await this.db
      .prepare(
        'INSERT INTO idn_audit (id, tenant_id, actor, event, subject, detail, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        ulid(now),
        e.tenantId,
        e.actor,
        e.event,
        e.subject ?? null,
        e.detail ? JSON.stringify(e.detail) : null,
        now,
      )
      .run();
  }
}
