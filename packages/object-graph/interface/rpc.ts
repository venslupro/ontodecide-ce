/**
 * @fileoverview ObjectGraphRpc implementation: maps the contract onto the
 * use cases. Errors are AppErrors and survive the RPC boundary.
 */

import type {GraphDeps} from '../application';
import {
  applyAction,
  getLinks,
  getObject,
  getObjects,
  impactSubgraph,
  listActionLog,
  listObjects,
  patchObject,
  stats,
  upsertBatch,
} from '../application';
import type {ObjectGraphRpc} from '../contract/rpc';

/** Builds the ObjectGraphRpc handler object. */
export function createObjectGraphRpc(deps: GraphDeps): ObjectGraphRpc {
  return {
    getObject: (ctx, rid) => getObject(deps, ctx, rid),
    getObjects: (ctx, rids) => getObjects(deps, ctx, rids),
    listObjects: (ctx, q, page) => listObjects(deps, ctx, q, page),
    patchObject: (ctx, rid, patch, ifMatch) =>
      patchObject(deps, ctx, rid, patch, ifMatch),
    getLinks: (ctx, rid, q) => getLinks(deps, ctx, rid, q),
    impactSubgraph: (ctx, q) => impactSubgraph(deps, ctx, q),
    stats: ctx => stats(deps, ctx),
    upsertBatch: (ctx, cmd) => upsertBatch(deps, ctx, cmd),
    applyAction: (ctx, cmd) => applyAction(deps, ctx, cmd),
    listActionLog: (ctx, rid, page) => listActionLog(deps, ctx, rid, page),
  };
}
