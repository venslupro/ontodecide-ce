/**
 * @fileoverview Tenancy read model used by the other modules: workspace
 * lookups and DTO mapping.
 */

import type {WorkspaceDto, WorkspaceStatusDto} from '../../contract';
import type {WorkspaceRecord, WorkspaceRepository} from '../ports';

/** Maps a workspace row to its DTO. */
export function toWorkspaceDto(
  w: WorkspaceRecord,
  verifiedAt: number,
): WorkspaceDto {
  return {
    tenantId: w.tenantId,
    kind: w.kind,
    status: w.status,
    verifiedAt: new Date(verifiedAt).toISOString(),
    trialExpiresAt:
      w.trialExpiresAt === null
        ? null
        : new Date(w.trialExpiresAt).toISOString(),
    expiredAt:
      w.expiredAt === null ? null : new Date(w.expiredAt).toISOString(),
  };
}

/** Workspace lookups. */
export class WorkspaceDirectory {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  get(tenantId: string): Promise<WorkspaceRecord | null> {
    return this.workspaces.get(tenantId);
  }

  /** `workspaceStatus` RPC (gateway Act-as checks). */
  async status(tenantId: string): Promise<WorkspaceStatusDto | null> {
    const w = await this.workspaces.get(tenantId);
    return w ? {kind: w.kind, status: w.status} : null;
  }
}
