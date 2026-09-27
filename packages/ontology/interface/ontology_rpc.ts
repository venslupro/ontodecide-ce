/**
 * @fileoverview RPC handler object implementing the OntologyRpc contract.
 * Normalizes every failure to an {@link AppError} (which survives Workers
 * RPC) and logs unexpected ones without payloads.
 */

import {AppError, type Logger} from '@ontodecide/shared-kernel';
import type {OntologyRpc} from '../contract';
import type {OntologyHandlers} from '../application';

async function guard<T>(
  logger: Logger,
  method: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const err = AppError.from(e);
    if (err.code === 'INTERNAL') {
      logger.error('rpc failed', {method, error: err.detail?.slice(0, 200)});
    }
    throw err;
  }
}

/** Creates the OntologyRpc implementation over the use-case handlers. */
export function createOntologyRpc(
  h: OntologyHandlers,
  logger: Logger,
): OntologyRpc {
  return {
    getCompiledSchema: ctx =>
      guard(logger, 'getCompiledSchema', () => h.getCompiledSchema(ctx)),
    getOntology: ctx => guard(logger, 'getOntology', () => h.getOntology(ctx)),
    getTemplateSeeds: templateId =>
      guard(logger, 'getTemplateSeeds', () => h.getTemplateSeeds(templateId)),
    listDefinitions: (ctx, kind) =>
      guard(logger, 'listDefinitions', () => h.listDefinitions(ctx, kind)),
    getDefinition: (ctx, kind, id) =>
      guard(logger, 'getDefinition', () => h.getDefinition(ctx, kind, id)),
    putDefinition: (ctx, kind, id, def, ifMatch) =>
      guard(logger, 'putDefinition', () =>
        h.putDefinition(ctx, kind, id, def, ifMatch),
      ),
    deleteDefinition: (ctx, kind, id, ifMatch) =>
      guard(logger, 'deleteDefinition', () =>
        h.deleteDefinition(ctx, kind, id, ifMatch),
      ),
  };
}
