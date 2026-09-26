/**
 * @fileoverview Composition root of ontology-manager.
 */

import {
  createLogger,
  systemClock,
  type Clock,
  type Logger,
} from '@ontodecide/shared-kernel';
import {
  createOntologyHandlers,
  type OntologyDeps,
  type OntologyHandlers,
  type SchemaCache,
  type SchemaRepository,
} from '@ontodecide/ontology/application';
import type {OntologyRpc} from '@ontodecide/ontology/contract';
import {
  D1SchemaRepository,
  TieredSchemaCache,
} from '@ontodecide/ontology/infrastructure';
import {createOntologyRpc} from '@ontodecide/ontology/interface';
import type {Env} from './env';

/** Test / wiring overrides. */
export interface Overrides {
  clock?: Clock;
  logger?: Logger;
}

/** Assembled ontology-manager dependencies. */
export interface Container {
  repo: SchemaRepository;
  cache: SchemaCache;
  handlers: OntologyHandlers;
  rpc: OntologyRpc;
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
    });
  const repo = new D1SchemaRepository(env.ONTOLOGY_DB);
  const cache = new TieredSchemaCache(env.SCHEMA_CACHE, clock, logger);
  const deps: OntologyDeps = {repo, cache, clock, logger};
  const handlers = createOntologyHandlers(deps);
  return {repo, cache, handlers, rpc: createOntologyRpc(handlers)};
}
