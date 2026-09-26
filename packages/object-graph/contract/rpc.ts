/**
 * @fileoverview RPC contract exposed by object-graph (ObjectGraphRpc).
 */

import type {
  CallCtx,
  ObjectSetDef,
  PageRequest,
  Rid,
} from '@ontodecide/shared-kernel';
import type {
  ActionLogDto,
  ActionResult,
  AggregateQuery,
  ApplyActionCmd,
  GraphSlice,
  ImpactQuery,
  LineageDto,
  ListObjectsQuery,
  MergeSuggestionDto,
  ObjectDto,
  ObjectPage,
  ObjectSetDto,
} from './types';

/** Object graph RPC surface. */
export interface ObjectGraphRpc {
  getObject(
    ctx: CallCtx,
    rid: Rid,
    opts?: {expand?: 'links'; depth?: 1 | 2},
  ): Promise<ObjectDto | null>;
  getObjects(ctx: CallCtx, rids: Rid[]): Promise<ObjectDto[]>;
  listObjects(
    ctx: CallCtx,
    type: string,
    q?: ListObjectsQuery,
  ): Promise<ObjectPage>;
  evaluateObjectSet(
    ctx: CallCtx,
    def: ObjectSetDef,
    page?: PageRequest,
  ): Promise<ObjectPage>;
  aggregate(ctx: CallCtx, q: AggregateQuery): Promise<number>;
  listObjectSets(ctx: CallCtx): Promise<ObjectSetDto[]>;
  saveObjectSet(
    ctx: CallCtx,
    input: {id?: string; name: string; definition: ObjectSetDef},
  ): Promise<ObjectSetDto>;
  evaluateSavedObjectSet(
    ctx: CallCtx,
    id: string,
    page?: PageRequest,
  ): Promise<ObjectPage>;
  search(
    ctx: CallCtx,
    q: string,
    opts?: {type?: string; limit?: number},
  ): Promise<ObjectDto[]>;
  lineage(ctx: CallCtx, rid: Rid): Promise<LineageDto>;
  /** ≤ 2 hops from D1; 3 hops from Neo4j with D1 fallback (degraded). */
  impactSubgraph(
    ctx: CallCtx,
    q: ImpactQuery,
  ): Promise<GraphSlice & {degraded: boolean}>;
  paths(
    ctx: CallCtx,
    q: {from: Rid; to: Rid; maxHops?: number},
  ): Promise<{paths: Rid[][]; degraded: boolean}>;
  applyAction(ctx: CallCtx, cmd: ApplyActionCmd): Promise<ActionResult>;
  listActionLog(
    ctx: CallCtx,
    filter?: {rid?: Rid; limit?: number},
  ): Promise<ActionLogDto[]>;
  listMergeSuggestions(ctx: CallCtx): Promise<MergeSuggestionDto[]>;
  resolveMergeSuggestion(
    ctx: CallCtx,
    id: string,
    accept: boolean,
  ): Promise<MergeSuggestionDto>;
  /**
   * Reacts to OntologyPublished (orchestrated by api-gateway): rebuilds
   * og_prop_index for changed index plan entries.
   */
  onOntologyPublished(
    ctx: CallCtx,
    evt: {api: string; version: string; breaking: boolean},
  ): Promise<{reindexed: number}>;
  /** Rebuilds the Neo4j projection from D1 (admin). */
  rebuildProjection(ctx: CallCtx): Promise<{queued: number}>;
}
