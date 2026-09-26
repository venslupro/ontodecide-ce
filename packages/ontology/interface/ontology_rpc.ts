/**
 * @fileoverview RPC handler object implementing the OntologyRpc contract.
 * Role checks are repeated here as defense in depth (the gateway checks
 * first): reads need Viewer, writes need Modeler.
 */

import {
  AppError,
  hasRole,
  type CallCtx,
  type Role,
} from '@ontodecide/shared-kernel';
import type {OntologyHandlers} from '../application';
import type {OntologyRpc} from '../contract';

function authorize(ctx: CallCtx, min: Role): void {
  if (!ctx || typeof ctx.tenantId !== 'string' || !ctx.tenantId) {
    throw new AppError('AUTH_INVALID', 'Missing tenant in call context');
  }
  if (!hasRole(ctx.roles ?? [], min)) {
    throw new AppError('FORBIDDEN', `Requires role ${min}`);
  }
}

/** Builds the OntologyRpc implementation from the use-case handlers. */
export function createOntologyRpc(h: OntologyHandlers): OntologyRpc {
  return {
    async listSchemas(ctx) {
      authorize(ctx, 'Viewer');
      return h.listSchemas.execute(ctx);
    },
    async getSchema(ctx, api, version) {
      authorize(ctx, 'Viewer');
      return h.getSchema.execute(ctx, api, version);
    },
    async getCompiledSchema(ctx, api, version) {
      authorize(ctx, 'Viewer');
      return h.getCompiledSchema.execute(ctx, api, version);
    },
    async getActiveModel(ctx) {
      authorize(ctx, 'Viewer');
      return h.getActiveModel.execute(ctx);
    },
    async saveDraft(ctx, api, def) {
      authorize(ctx, 'Modeler');
      return h.saveDraft.execute(ctx, api, def);
    },
    async diff(ctx, api) {
      authorize(ctx, 'Modeler');
      return h.diff.execute(ctx, api);
    },
    async publish(ctx, api, opts) {
      authorize(ctx, 'Modeler');
      return h.publish.execute(ctx, api, opts);
    },
    async listPacks(ctx) {
      authorize(ctx, 'Viewer');
      return h.listPacks.execute(ctx);
    },
    async getPack(ctx, id) {
      authorize(ctx, 'Viewer');
      return h.getPack.execute(ctx, id);
    },
    async importPack(ctx, input) {
      authorize(ctx, 'Modeler');
      return h.importPack.execute(ctx, input);
    },
    async exportPack(ctx, api) {
      authorize(ctx, 'Modeler');
      return h.exportPack.execute(ctx, api);
    },
    async evaluateFunction(ctx, fn, props) {
      authorize(ctx, 'Viewer');
      return h.evaluateFunction.execute(ctx, fn, props);
    },
  };
}
