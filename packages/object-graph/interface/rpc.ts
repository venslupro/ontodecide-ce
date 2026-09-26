/**
 * @fileoverview RPC handler object implementing the ObjectGraphRpc contract
 * by delegating to the use cases.
 */

import {AppError, parseOrThrow} from '@ontodecide/shared-kernel';
import type {
  CallCtx,
  ObjectSetDef,
  PageRequest,
  Rid,
} from '@ontodecide/shared-kernel';
import {objectSetDefSchema} from '../contract';
import type {ObjectGraphRpc} from '../contract';
import {
  AggregateObjects,
  ApplyAction,
  EvaluateObjectSet,
  EvaluateSavedObjectSet,
  FindPaths,
  GetLineage,
  GetObject,
  GetObjects,
  ImpactSubgraph,
  ListActionLog,
  ListMergeSuggestions,
  ListObjectSets,
  ListObjects,
  OnOntologyPublished,
  RebuildProjection,
  ResolveMergeSuggestion,
  SaveObjectSet,
  SearchObjects,
} from '../application';
import type {AppDeps} from '../application';

function objectSetDef(def: unknown): ObjectSetDef {
  try {
    return parseOrThrow(objectSetDefSchema, def) as ObjectSetDef;
  } catch (e) {
    const err = AppError.from(e);
    throw new AppError('OBJECT_SET_INVALID', err.detail, err.extras);
  }
}

function page(p: PageRequest | undefined): PageRequest {
  return {cursor: p?.cursor, limit: p?.limit};
}

/** Builds the RPC surface of object-graph. */
export function createObjectGraphRpc(deps: AppDeps): ObjectGraphRpc {
  const getObject = new GetObject(deps);
  const getObjects = new GetObjects(deps);
  const listObjects = new ListObjects(deps);
  const evaluate = new EvaluateObjectSet(deps);
  const aggregate = new AggregateObjects(deps);
  const listSets = new ListObjectSets(deps);
  const saveSet = new SaveObjectSet(deps);
  const evaluateSaved = new EvaluateSavedObjectSet(deps);
  const search = new SearchObjects(deps);
  const lineage = new GetLineage(deps);
  const impact = new ImpactSubgraph(deps);
  const paths = new FindPaths(deps);
  const applyAction = new ApplyAction(deps);
  const listActionLog = new ListActionLog(deps);
  const listSuggestions = new ListMergeSuggestions(deps);
  const resolveSuggestion = new ResolveMergeSuggestion(deps);
  const onPublished = new OnOntologyPublished(deps);
  const rebuild = new RebuildProjection(deps);

  return {
    getObject: (
      ctx: CallCtx,
      rid: Rid,
      opts?: {expand?: 'links'; depth?: 1 | 2},
    ) => getObject.handle(ctx, rid, opts),
    getObjects: (ctx, rids) => getObjects.handle(ctx, rids ?? []),
    listObjects: (ctx, type, q = {}) => {
      if (q.filter) objectSetDef({objectType: type || '?', filter: q.filter});
      return listObjects.handle(ctx, type, q);
    },
    evaluateObjectSet: (ctx, def, p) =>
      evaluate.handle(ctx, objectSetDef(def), page(p)),
    aggregate: (ctx, q) =>
      aggregate.handle(ctx, {...q, objectSet: objectSetDef(q.objectSet)}),
    listObjectSets: ctx => listSets.handle(ctx),
    saveObjectSet: (ctx, input) => saveSet.handle(ctx, input),
    evaluateSavedObjectSet: (ctx, id, p) =>
      evaluateSaved.handle(ctx, id, page(p)),
    search: (ctx, q, opts) => search.handle(ctx, q, opts),
    lineage: (ctx, rid) => lineage.handle(ctx, rid),
    impactSubgraph: (ctx, q) => impact.handle(ctx, q),
    paths: (ctx, q) => paths.handle(ctx, q),
    applyAction: (ctx, cmd) => applyAction.handle(ctx, cmd),
    listActionLog: (ctx, filter) => listActionLog.handle(ctx, filter),
    listMergeSuggestions: ctx => listSuggestions.handle(ctx),
    resolveMergeSuggestion: (ctx, id, accept) =>
      resolveSuggestion.handle(ctx, id, Boolean(accept)),
    onOntologyPublished: (ctx, evt) => onPublished.handle(ctx, evt),
    rebuildProjection: ctx => rebuild.handle(ctx),
  };
}
