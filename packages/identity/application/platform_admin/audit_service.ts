/**
 * @fileoverview PlatformAdmin: the append-only admin_audit hash chain and
 * the Idempotency-Key replay store for /admin writes (a replay returns the
 * stored `result` of the first execution, or re-reads current data when the
 * write stores a PII-free marker instead).
 *
 * No personal data is written (修订说明书 6.4: after the target user is
 * deleted only tenant_id remains): new rows carry target_tenant_id only
 * (target_user_id stays NULL) and results never contain e-mail addresses.
 */

import {
  AppError,
  HOUR_MS,
  clampLimit,
  decodeCursor,
  encodeCursor,
  isIdempotencyKey,
  ulid,
  type CallCtx,
  type Clock,
  type PageRequest,
  type PageResult,
} from '@ontodecide/shared-kernel';
import type {AdminAuditDto, AuditEntry} from '../../contract';
import {
  GENESIS_HASH,
  computeRowHash,
  verifyChain,
  type AuditAction,
  type AuditRow,
} from '../../domain';
import type {AuditRepository} from '../ports';

/** What is recorded for one admin action (no personal data). */
export interface AuditRecord {
  action: AuditAction;
  targetTenantId?: string | null;
  reason?: string | null;
}

/** How an idempotent write stores and replays its result. */
export interface IdempotentOptions<T> {
  /** PII-free value stored in `result` (default: the result itself). */
  stored?: (result: T) => unknown;
  /** Rebuilds the response of a replay from the stored value. */
  replay?: (stored: unknown) => Promise<T>;
}

const APPEND_RETRIES = 5;

/** Audit chain writes and reads. */
export class AuditService {
  constructor(
    private readonly audit: AuditRepository,
    private readonly clock: Clock,
  ) {}

  /** Appends one row (retries when another append moved the chain head). */
  async append(
    rec: AuditRecord,
    idempotencyKey: string | null = null,
    result: unknown = undefined,
  ): Promise<AuditRow> {
    for (let i = 0; i < APPEND_RETRIES; i++) {
      const head = await this.audit.latest();
      const now = this.clock.now().getTime();
      // Strictly increasing `at` keeps (at, id) order equal to chain order.
      const at = Math.max(now, (head?.at ?? 0) + 1);
      const content = {
        id: ulid(at),
        at,
        action: rec.action,
        targetTenantId: rec.targetTenantId ?? null,
        // Never stored for new rows: only tenant_id survives the account.
        targetUserId: null,
        reason: rec.reason ?? null,
        idempotencyKey,
        result: result === undefined ? null : JSON.stringify(result),
      };
      const prevHash = head?.rowHash ?? GENESIS_HASH;
      const row: AuditRow = {
        ...content,
        prevHash,
        rowHash: await computeRowHash(prevHash, content),
      };
      const r = await this.audit.append(row);
      if (r === 'ok') return row;
      if (r === 'duplicate') {
        const first = idempotencyKey
          ? await this.audit.findByKey(idempotencyKey)
          : null;
        if (first) return first;
      }
    }
    throw new AppError('UNAVAILABLE', 'AUDIT_BUSY');
  }

  /**
   * Runs an /admin write once per Idempotency-Key: a replay returns the
   * stored result without running `fn` again. The audit row is written after
   * `fn` succeeds, together with the result.
   */
  async idempotent<T>(
    key: string,
    rec: AuditRecord | ((result: T) => AuditRecord),
    fn: () => Promise<T>,
    opts: IdempotentOptions<T> = {},
  ): Promise<T> {
    if (!isIdempotencyKey(key)) {
      throw new AppError('VALIDATION_FAILED', 'Idempotency-Key required', {
        extras: {
          errors: [
            {path: 'Idempotency-Key', message: 'Required (16-64 chars)'},
          ],
        },
      });
    }
    const replay = async (row: AuditRow): Promise<T> => {
      const v = row.result === null ? undefined : JSON.parse(row.result);
      return opts.replay ? opts.replay(v) : (v as T);
    };
    const seen = await this.audit.findByKey(key);
    if (seen) return replay(seen);
    const result = await fn();
    const stored = opts.stored ? opts.stored(result) : result;
    const value = stored === undefined ? null : stored;
    const serialized = JSON.stringify(value);
    const row = await this.append(
      typeof rec === 'function' ? rec(result) : rec,
      key,
      value,
    );
    // A concurrent first execution may have won the key: return its result.
    if (row.result === null || row.result === serialized) return result;
    return replay(row);
  }

  /** Gateway entries: act_as.enter (≤ 1 per workspace per hour), tenant.write. */
  async record(ctx: CallCtx, entry: AuditEntry): Promise<void> {
    if (ctx.actor.role !== 'admin') throw new AppError('FORBIDDEN');
    if (entry.action !== 'act_as.enter' && entry.action !== 'tenant.write') {
      throw new AppError('VALIDATION_FAILED', 'Unknown audit action');
    }
    if (
      entry.action === 'act_as.enter' &&
      (await this.audit.hasSince(
        'act_as.enter',
        entry.targetTenantId,
        this.clock.now().getTime() - HOUR_MS,
      ))
    ) {
      return;
    }
    await this.append({
      action: entry.action,
      targetTenantId: entry.targetTenantId,
      reason: entry.reason?.slice(0, 200) ?? null,
    });
  }

  /** GET /admin/audit-log with the chain verification result. */
  async page(
    req: PageRequest,
  ): Promise<PageResult<AdminAuditDto> & {chainOk: boolean}> {
    const limit = clampLimit(req.limit);
    const cursor = decodeCursor<{at: number; id: string}>(req.cursor);
    const rows = await this.audit.page(cursor, limit + 1);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(r => ({
        id: r.id,
        at: new Date(r.at).toISOString(),
        action: r.action,
        targetTenantId: r.targetTenantId,
        targetUserId: r.targetUserId,
        reason: r.reason,
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({at: last.at, id: last.id})
          : null,
      chainOk: await verifyChain(await this.audit.all()),
    };
  }

  /** Latest chain head (daily anchor). */
  head(): Promise<AuditRow | null> {
    return this.audit.latest();
  }
}
