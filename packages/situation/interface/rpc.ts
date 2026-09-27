/**
 * @fileoverview SituationRpc implementation: validates inputs and routes
 * every call to the workspace's SituationRoom (`idFromName(ctx.tid)`).
 */

import {
  AppError,
  type CallCtx,
  clampLimit,
  parseOrThrow,
} from '@ontodecide/shared-kernel';
import {z} from 'zod';
import {parseAutomationDef, type SituationRoomApi} from '../application';
import type {SituationRpc} from '../contract/rpc';
import type {AlertFilter} from '../contract/types';

/** Resolves the room stub of a workspace. */
export type RoomResolver<T = SituationRoomApi> = (tid: string) => T;

const filterSchema = z.object({
  status: z.enum(['OPEN', 'ACKED', 'CLOSED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  rid: z.string().max(200).optional(),
});

function version(ifMatch: unknown): number {
  if (
    typeof ifMatch !== 'number' ||
    !Number.isInteger(ifMatch) ||
    ifMatch < 1
  ) {
    throw new AppError('PRECONDITION_FAILED', 'If-Match version required');
  }
  return ifMatch;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64) {
    throw new AppError('NOT_FOUND');
  }
  return value;
}

/** Builds the SituationRpc surface over room stubs. */
export function createSituationRpc(rooms: RoomResolver): SituationRpc {
  const room = (ctx: CallCtx): SituationRoomApi => rooms(ctx.tid);
  return {
    overview: async (ctx, q) =>
      room(ctx).overview(ctx, {range: q?.range === '7d' ? '7d' : '24h'}),
    listAlerts: async (ctx, filter, page) =>
      room(ctx).listAlerts(
        ctx,
        parseOrThrow(filterSchema, filter ?? {}) as AlertFilter,
        {
          ...(page?.cursor ? {cursor: String(page.cursor)} : {}),
          limit: clampLimit(page?.limit),
        },
      ),
    acknowledgeAlert: async (ctx, alertId) =>
      room(ctx).acknowledgeAlert(ctx, id(alertId)),
    listAutomations: async ctx => room(ctx).listAutomations(ctx),
    getAutomation: async (ctx, automationId) =>
      room(ctx).getAutomation(ctx, id(automationId)),
    createAutomation: async (ctx, def) =>
      room(ctx).createAutomation(ctx, parseAutomationDef(def)),
    putAutomation: async (ctx, automationId, def, ifMatch) =>
      room(ctx).putAutomation(
        ctx,
        id(automationId),
        parseAutomationDef(def),
        version(ifMatch),
      ),
    deleteAutomation: async (ctx, automationId, ifMatch) =>
      room(ctx).deleteAutomation(ctx, id(automationId), version(ifMatch)),
    issueStreamTicket: async ctx => room(ctx).issueStreamTicket(ctx),
    pushRecommendation: async (ctx, rec) =>
      room(ctx).pushRecommendation(ctx, rec),
  };
}
