/**
 * @fileoverview situation-events consumer use case: usage recording,
 * automation evaluation, alert raising and KPI refresh.
 */

import type {SituationEventMsg} from '@ontodecide/object-graph/contract';
import {systemCtx} from '@ontodecide/shared-kernel';
import {AutomationIndex, countCrosses} from '../domain';
import type {SituationDeps} from './deps';
import {publish, raiseAlert, refreshKpis} from './support';

/** Outcome of one event. */
export interface EventOutcome {
  duplicate: boolean;
  alertsRaised: number;
  kpisRefreshed: number;
}

/** Per-batch cache of automation indexes by tenant. */
export type AutomationIndexCache = Map<string, AutomationIndex>;

/**
 * Processes one `situation-events` message; idempotent by eventId. Errors
 * propagate so the queue retries the message.
 */
export class ProcessSituationEvent {
  constructor(private readonly deps: SituationDeps) {}

  async execute(
    msg: SituationEventMsg,
    cache: AutomationIndexCache = new Map(),
  ): Promise<EventOutcome> {
    const {repos, clock, logger} = this.deps;
    if (await repos.processedEvents.has(msg.eventId)) {
      return {duplicate: true, alertsRaised: 0, kpisRefreshed: 0};
    }
    const tenantId = msg.tenantId;
    const ctx = systemCtx(tenantId, msg.eventId);
    const now = clock.now();

    if (msg.usage?.length) {
      try {
        const status = await this.deps.usage().record(msg.usage);
        if (status.level !== 'ok') {
          await publish(this.deps, tenantId, 'usage', status);
        }
      } catch (e) {
        logger.warn('usage record failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    let index = cache.get(tenantId);
    if (!index) {
      index = new AutomationIndex(await repos.automations.list(tenantId));
      cache.set(tenantId, index);
    }

    let alertsRaised = 0;
    const opts = {now, correlationId: msg.eventId};
    for (const change of msg.changes ?? []) {
      for (const auto of index.matching(change)) {
        const r = await raiseAlert(
          this.deps,
          tenantId,
          auto,
          {rid: change.rid, title: change.title, snapshot: change.after},
          opts,
        );
        if (r.created) alertsRaised++;
      }
    }

    const types = new Set((msg.changes ?? []).map(c => c.type));
    for (const auto of index.countRulesFor(types)) {
      if (auto.trigger.kind !== 'objectSetCount') continue;
      const t = auto.trigger;
      const count = await this.deps.objects.aggregate(ctx, {
        objectSet: t.objectSet,
        fn: 'count',
      });
      if (!countCrosses(count, t.op, t.value)) continue;
      const r = await raiseAlert(
        this.deps,
        tenantId,
        auto,
        {
          rid: null,
          title: `${t.objectSet.objectType} count ${t.op} ${t.value}`,
          snapshot: {count},
        },
        opts,
      );
      if (r.created) alertsRaised++;
    }

    let kpisRefreshed = 0;
    if (types.size > 0) {
      const kpis = (await repos.kpis.list(tenantId)).filter(k =>
        types.has(k.objectSet.objectType),
      );
      if (kpis.length > 0) {
        kpisRefreshed = (await refreshKpis(this.deps, ctx, kpis)).length;
      }
    }

    await repos.processedEvents.add(msg.eventId, clock.now().getTime());
    return {duplicate: false, alertsRaised, kpisRefreshed};
  }
}
