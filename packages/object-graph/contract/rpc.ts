/**
 * @fileoverview RPC contract of object-graph (ObjectGraphRpc entry point).
 * Depends on ontology-manager only.
 */

import type {CallCtx, PageRequest, Rid} from '@ontodecide/shared-kernel';
import type {
  ActionLogDto,
  ActionResult,
  ApplyActionCmd,
  GraphSlice,
  GraphStats,
  ImpactQuery,
  LinksQuery,
  MergePatch,
  ObjectDto,
  ObjectPage,
  ObjectQuery,
  UpsertCmd,
  WriteResult,
} from './types';

/** object-graph RPC surface. */
export interface ObjectGraphRpc {
  /** null when missing or in another workspace. */
  getObject(ctx: CallCtx, rid: Rid): Promise<ObjectDto | null>;
  /** Batch read by rid (situation consumer); missing rids are omitted. */
  getObjects(ctx: CallCtx, rids: Rid[]): Promise<ObjectDto[]>;
  listObjects(
    ctx: CallCtx,
    q: ObjectQuery,
    page: PageRequest,
  ): Promise<ObjectPage>;
  /**
   * Merge-patches properties when `ifMatch` equals the version; otherwise
   * PRECONDITION_FAILED. Writes one ObjectPatched outbox row.
   */
  patchObject(
    ctx: CallCtx,
    rid: Rid,
    patch: MergePatch,
    ifMatch: number,
  ): Promise<ObjectDto>;
  /** Links around an object (D1 recursive CTE, depth ≤ 2). */
  getLinks(ctx: CallCtx, rid: Rid, q: LinksQuery): Promise<GraphSlice>;
  /** Outgoing impact subgraph for the simulator. */
  impactSubgraph(ctx: CallCtx, q: ImpactQuery): Promise<GraphSlice>;
  stats(ctx: CallCtx): Promise<GraphStats>;
  /**
   * Writes ≤ 100 mapped rows in one statement per table plus one outbox
   * row. Re-enforces the object (300) and link (900) limits.
   */
  upsertBatch(
    ctx: CallCtx,
    cmd: {jobId: string; seq: number; cmds: UpsertCmd[]},
  ): Promise<WriteResult>;
  /**
   * Executes an action. A replayed idempotency key returns the first
   * result; a version mismatch is PRECONDITION_FAILED; unmet preconditions
   * are VALIDATION_FAILED (422).
   */
  applyAction(ctx: CallCtx, cmd: ApplyActionCmd): Promise<ActionResult>;
  /** Action audit of one object (newest first). */
  listActionLog(
    ctx: CallCtx,
    rid: Rid,
    page: PageRequest,
  ): Promise<{items: ActionLogDto[]; nextCursor: string | null}>;
}
