/**
 * @fileoverview Room runtime shared by the use cases: workspace binding,
 * DTO mapping, realtime push, alert evaluation and alarm scheduling.
 */

import {
  AppError,
  type CallCtx,
  DAY_MS,
  type Rid,
  isServiceCtx,
  matchFilter,
  parseJson,
  ulid,
} from '@ontodecide/shared-kernel';
import {
  type AlertDto,
  type AutomationDto,
  type KpiValue,
  type RecommendationSummary,
  WS_REPLAY_MAX,
  type WsMsg,
} from '../contract/types';
import {
  type AutomationRule,
  type ObjectView,
  RuleIndex,
  decideAlert,
  earliest,
} from '../domain';
import type {RoomDeps} from './deps';
import type {AlertRecord, AutomationRecord, KpiRecord} from './ports';

/** Meta keys of the room. */
export const META = {
  tid: 'tid',
  initialized: 'initialized_at',
  inactive: 'inactive',
  metricFlushAt: 'metric_flush_at',
  recommendation: 'recommendation',
  socketSeq: 'socket_seq',
} as const;

const iso = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString();

/** Maps a stored alert to its DTO. */
export function toAlertDto(a: AlertRecord): AlertDto {
  return {
    id: a.id,
    automationId: a.automationId,
    automationName: a.automationName,
    rid: a.rid as Rid | null,
    title: a.title,
    severity: a.severity,
    status: a.status,
    snapshot: a.snapshot,
    hits: a.hits,
    raisedAt: new Date(a.raisedAt).toISOString(),
    ackedAt: iso(a.ackedAt),
    closedAt: iso(a.closedAt),
  };
}

/** Maps a stored automation to its DTO. */
export function toAutomationDto(a: AutomationRecord): AutomationDto {
  return {
    id: a.id,
    name: a.name,
    trigger: a.trigger,
    objectType: a.objectType,
    condition: a.condition,
    ...(a.everyHours !== undefined ? {everyHours: a.everyHours} : {}),
    severity: a.severity,
    cooldownSec: a.cooldownSec,
    enabled: a.enabled,
    version: a.version,
    nextRunAt: iso(a.nextRunAt),
    lastFiredAt: iso(a.lastFiredAt),
  };
}

function toRule(a: AutomationRecord): AutomationRule {
  return {
    id: a.id,
    trigger: a.trigger,
    objectType: a.objectType,
    condition: a.condition,
    everyHours: a.everyHours ?? null,
    enabled: a.enabled,
    cooldownSec: a.cooldownSec,
  };
}

/** In-memory state and shared operations of one room. */
export class RoomRuntime {
  private rules: {
    index: RuleIndex;
    byId: Map<string, AutomationRecord>;
  } | null = null;
  /** Pending first initialization (deduplicates concurrent callers). */
  initializing: Promise<void> | null = null;

  constructor(readonly deps: RoomDeps) {}

  /** Current time (Unix ms). */
  now(): number {
    return this.deps.clock.now().getTime();
  }

  /** Drops in-memory caches (after purge or storage reset). */
  reset(): void {
    this.rules = null;
    this.initializing = null;
  }

  /** Whether the room only holds its tombstone. */
  tombstoned(): boolean {
    return this.deps.store.tombstoneUntil() !== null;
  }

  /**
   * Binds the room to its workspace on first use. Throws NOT_FOUND when the
   * room is tombstoned or belongs to another workspace.
   */
  bindTid(tid: string): void {
    if (this.tombstoned()) throw new AppError('NOT_FOUND', 'Workspace removed');
    const store = this.deps.store;
    const bound = store.getMeta(META.tid);
    if (bound === null) store.setMeta(META.tid, tid);
    else if (bound !== tid) throw new AppError('NOT_FOUND');
  }

  /**
   * Entry of every business call: binds the workspace and, for calls made
   * by a person (only possible while the workspace is active), clears the
   * inactive flag set by closeStreams. Returns true if it was cleared.
   */
  touch(ctx: CallCtx): boolean {
    this.bindTid(ctx.tid);
    if (!isServiceCtx(ctx) && this.deps.store.getMeta(META.inactive) !== null) {
      this.deps.store.deleteMeta(META.inactive);
      return true;
    }
    return false;
  }

  /** The bound workspace id. */
  tid(): string | null {
    return this.deps.store.getMeta(META.tid);
  }

  /** Whether KPIs and sample automations were installed. */
  initialized(): boolean {
    return this.deps.store.getMeta(META.initialized) !== null;
  }

  /** Threshold rule index (rebuilt lazily after automation changes). */
  ruleIndex(): {index: RuleIndex; byId: Map<string, AutomationRecord>} {
    if (!this.rules) {
      const all = this.deps.store.listAutomations();
      this.rules = {
        index: new RuleIndex(all.map(toRule)),
        byId: new Map(all.map(a => [a.id, a])),
      };
    }
    return this.rules;
  }

  /** Invalidates the rule index. */
  rulesChanged(): void {
    this.rules = null;
  }

  /** Appends a realtime message and sends it to every connection. */
  push(type: Exclude<WsMsg['type'], 'snapshot'>, data: unknown): WsMsg {
    const now = this.now();
    const store = this.deps.store;
    const seq = store.appendWs(type, data, now);
    store.pruneWs(WS_REPLAY_MAX);
    const msg: WsMsg = {
      seq,
      type,
      data,
      occurredAt: new Date(now).toISOString(),
    };
    const text = JSON.stringify(msg);
    for (const s of this.deps.sockets.list()) {
      try {
        s.send(text);
      } catch {
        // Closing socket; the client resumes with lastSeq.
      }
    }
    return msg;
  }

  /** KPI DTO with the value 24 h ago. */
  kpiValue(k: KpiRecord): KpiValue {
    const previous =
      this.deps.store.pointAtOrBefore(k.id, this.now() - DAY_MS)?.value ?? null;
    return {
      id: k.id,
      name: k.name,
      objectType: k.objectType,
      aggregate: k.aggregate,
      value: k.state.value,
      previous,
      target: k.target,
      unit: k.unit,
      higherIsBetter: k.higherIsBetter,
      updatedAt: iso(k.updatedAt),
    };
  }

  /** Latest recommendation pushed by decision-engine. */
  recommendation(): RecommendationSummary | null {
    return parseJson<RecommendationSummary | null>(
      this.deps.store.getMeta(META.recommendation),
      null,
    );
  }

  /**
   * Evaluates one rule for one object and applies the alert policy.
   * `obj` null means the object no longer exists. Changed alerts are
   * appended to `out`.
   */
  evaluate(
    rule: AutomationRecord,
    rid: string,
    obj: ObjectView | null,
    out: AlertRecord[],
  ): void {
    const store = this.deps.store;
    const now = this.now();
    const matches =
      obj !== null &&
      rule.enabled &&
      obj.type === rule.objectType &&
      matchFilter(rule.condition, obj.props);
    const active = store.activeAlert(rule.id, rid);
    const lastClosed =
      matches && !active ? store.lastClosedAlert(rule.id, rid) : null;
    const d = decideAlert({
      matches,
      active,
      lastClosed,
      cooldownSec: rule.cooldownSec,
      now,
    });
    switch (d.kind) {
      case 'none':
        return;
      case 'raise': {
        const a: AlertRecord = {
          id: ulid(now),
          automationId: rule.id,
          automationName: rule.name,
          rid,
          title: obj!.title,
          severity: rule.severity,
          status: 'OPEN',
          snapshot: obj!.props,
          hits: 1,
          raisedAt: now,
          ackedAt: null,
          closedAt: null,
        };
        store.insertAlert(a);
        out.push(a);
        break;
      }
      case 'hit':
      case 'cooldown': {
        const base = d.kind === 'hit' ? active! : lastClosed!;
        const a: AlertRecord = {
          ...base,
          automationName: rule.name,
          title: obj!.title,
          severity: rule.severity,
          snapshot: obj!.props,
          hits: base.hits + 1,
        };
        store.updateAlert(a);
        out.push(a);
        break;
      }
      case 'close': {
        const a: AlertRecord = {...active!, status: 'CLOSED', closedAt: now};
        store.updateAlert(a);
        out.push(a);
        return;
      }
    }
    rule.lastFiredAt = now;
    store.setLastFired(rule.id, now);
  }

  /** Closes every active alert of an object that no longer exists. */
  closeAlertsOf(rid: string, out: AlertRecord[]): void {
    const now = this.now();
    for (const a of this.deps.store.activeAlertsFor(rid)) {
      const closed: AlertRecord = {...a, status: 'CLOSED', closedAt: now};
      this.deps.store.updateAlert(closed);
      out.push(closed);
    }
  }

  /** Pushes one `alert` message per changed alert (last state wins). */
  pushAlerts(changed: readonly AlertRecord[]): void {
    const latest = new Map<string, AlertRecord>();
    for (const a of changed) latest.set(a.id, a);
    for (const a of latest.values()) this.push('alert', toAlertDto(a));
  }

  /**
   * Sets the single DO alarm to min(next scheduled run, next metric flush),
   * or the tombstone expiry; clears it while the workspace is inactive.
   */
  async reschedule(): Promise<void> {
    const {store, storage} = this.deps;
    const until = store.tombstoneUntil();
    let next: number | null;
    if (until !== null) {
      next = until;
    } else if (store.getMeta(META.inactive) !== null) {
      next = null;
    } else {
      const flush = store.getMeta(META.metricFlushAt);
      next = earliest(
        flush === null ? null : Number(flush),
        ...store
          .listAutomations()
          .filter(a => a.trigger === 'schedule' && a.enabled)
          .map(a => a.nextRunAt),
      );
    }
    const current = await storage.getAlarm();
    if (next === null) {
      if (current !== null) await storage.deleteAlarm();
    } else if (current !== next) {
      await storage.setAlarm(next);
    }
  }
}
