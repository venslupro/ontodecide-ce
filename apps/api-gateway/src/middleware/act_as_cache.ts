/**
 * @fileoverview Isolate-memory cache of Act-as target workspace status
 * (详细设计 6.7: ≤ 60 s). A miss also remembers whether `act_as.enter` has
 * been recorded for the target during the cache window; identity-access
 * itself keeps at most one enter row per workspace per hour.
 */

import type {
  IdentityRpc,
  WorkspaceStatusDto,
} from '@ontodecide/identity/contract';
import type {Clock} from '@ontodecide/shared-kernel';

/** A cached target status. */
export interface ActAsEntry {
  status: WorkspaceStatusDto | null;
  /** act_as.enter was recorded while this entry is valid. */
  entered: boolean;
  at: number;
}

const MAX_ENTRIES = 500;

/** Workspace status cache for Act-as checks. */
export class ActAsCache {
  private readonly entries = new Map<string, ActAsEntry>();

  constructor(
    private readonly identity: () => IdentityRpc,
    private readonly clock: Clock,
    private readonly ttlMs: number,
  ) {}

  /** Cached (or freshly loaded) status of a workspace. */
  async get(tid: string): Promise<ActAsEntry> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(tid);
    if (hit && now - hit.at < this.ttlMs) return hit;
    const status = await this.identity().workspaceStatus(tid);
    const entry: ActAsEntry = {status, entered: false, at: now};
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(tid, entry);
    return entry;
  }
}
