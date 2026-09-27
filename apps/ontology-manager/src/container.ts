/**
 * @fileoverview Composition root of ontology-manager.
 */

import {
  createLogger,
  systemClock,
  type Clock,
  type Logger,
  type TenantLifecycleRpc,
} from '@ontodecide/shared-kernel';
import {
  createOntologyHandlers,
  createOntologyLifecycle,
  type CompiledCache,
} from '@ontodecide/ontology/application';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import {
  D1LifecycleRepository,
  D1TemplateRepository,
  D1WorkspaceSchemaRepository,
  MemoryCompiledCache,
} from '@ontodecide/ontology/infrastructure';
import {
  createOntologyRpc,
  createTenantLifecycle,
} from '@ontodecide/ontology/interface';
import type {Env} from './env';

/** Test / wiring overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
  cache?: CompiledCache;
}

/** Assembled ontology-manager dependencies. */
export interface Container {
  cache: CompiledCache;
  rpc: OntologyRpc;
  lifecycle: TenantLifecycleRpc;
}

/** Builds the container from the Worker bindings. */
export function createContainer(
  env: Env,
  overrides: Overrides = {},
): Container {
  const clock = overrides.clock ?? systemClock;
  const logger =
    overrides.logger ??
    createLogger({
      service: 'ontology-manager',
      env: env.ENVIRONMENT ?? 'local',
      version: env.APP_VERSION ?? 'dev',
    });
  const db = env.ONTOLOGY_DB;
  const cache = overrides.cache ?? new MemoryCompiledCache();
  const handlers = createOntologyHandlers({
    schemas: tid => new D1WorkspaceSchemaRepository(db, tid),
    templates: new D1TemplateRepository(db),
    cache,
    clock,
    logger,
  });
  const lifecycle = createTenantLifecycle(
    createOntologyLifecycle({store: new D1LifecycleRepository(db), clock}),
  );
  return {cache, rpc: createOntologyRpc(handlers, logger), lifecycle};
}
