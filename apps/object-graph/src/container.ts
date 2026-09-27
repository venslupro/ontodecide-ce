/**
 * @fileoverview Composition root of object-graph: binds the D1
 * repositories, the ontology adapter and the queue publisher to the use
 * cases. SystemRepository-backed stores are only built for the cron and the
 * TenantLifecycle entry point.
 */

import type {GraphDeps} from '@ontodecide/object-graph/application';
import type {ObjectGraphRpc} from '@ontodecide/object-graph/contract';
import {
  D1LifecycleStore,
  D1OutboxRelay,
  OntologySchemaProvider,
  QueueEventPublisher,
  createTenantRepos,
} from '@ontodecide/object-graph/infrastructure';
import {
  createCronHandler,
  createLifecycleRpc,
  createObjectGraphRpc,
} from '@ontodecide/object-graph/interface';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import {CE_LIMITS, createLogger, systemClock} from '@ontodecide/shared-kernel';
import type {
  Clock,
  DomainEventMsg,
  Logger,
  QueueSender,
  TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import type {Env} from './env';

/** Test and harness overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  /** Replaces the ONTOLOGY binding. */
  ontology?: Pick<OntologyRpc, 'getCompiledSchema'>;
  /** Replaces the DOMAIN_EVENTS binding. */
  queue?: Pick<QueueSender<DomainEventMsg>, 'send'>;
  /** Overrides the 64 KB message bound (tests). */
  maxEventBytes?: number;
}

/** Assembled object-graph service parts. */
export interface Container {
  rpc: ObjectGraphRpc;
  lifecycle: TenantLifecycleRpc;
  cron(cron: string, now: Date): Promise<void>;
}

function intVar(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Builds the container. */
export function createContainer(env: Env, o: Overrides = {}): Container {
  const clock = o.clock ?? systemClock;
  const logger =
    o.logger ??
    createLogger({service: 'object-graph', version: env.APP_VERSION});
  const publisher = new QueueEventPublisher(
    o.queue ?? env.DOMAIN_EVENTS,
    o.maxEventBytes,
  );
  const deps: GraphDeps = {
    repos: tid => createTenantRepos(env.OBJECT_DB, tid),
    schema: new OntologySchemaProvider(o.ontology ?? env.ONTOLOGY),
    publisher,
    clock,
    logger,
    caps: {
      maxObjects: intVar(env.MAX_OBJECTS, CE_LIMITS.objects),
      maxLinks: intVar(env.MAX_LINKS, CE_LIMITS.links),
    },
  };
  return {
    rpc: createObjectGraphRpc(deps),
    lifecycle: createLifecycleRpc({
      store: () => new D1LifecycleStore(env.OBJECT_DB),
      clock,
    }),
    cron: createCronHandler({
      store: () => new D1OutboxRelay(env.OBJECT_DB),
      publisher,
      clock,
      logger,
    }),
  };
}
