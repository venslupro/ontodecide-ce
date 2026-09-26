/**
 * @fileoverview Helpers shared by the use cases: role checks, DTO mapping
 * with markings, and outbox event construction.
 */

import {AppError, hasRole, parseRid, ulid} from '@ontodecide/shared-kernel';
import type {CallCtx, Rid, Role} from '@ontodecide/shared-kernel';
import type {
  CompiledModel,
  CompiledObjectType,
} from '@ontodecide/ontology/contract';
import type {
  GraphSyncMsg,
  ObjectChange,
  ObjectDto,
  SituationEventMsg,
} from '../contract';
import {filterByMarkings, hiddenPropNames} from '../domain';
import type {StoredObject} from '../domain';
import type {OutboxEvent} from './ports';

/** Throws FORBIDDEN unless the caller holds at least `min`. */
export function requireRole(ctx: CallCtx, min: Role): void {
  if (!hasRole(ctx.roles, min)) {
    throw new AppError('FORBIDDEN', `Requires role ${min}`);
  }
}

/** Whether a RID belongs to the caller's tenant (well-formed). */
export function ridInTenant(ctx: CallCtx, rid: string): rid is Rid {
  const parts = parseRid(rid);
  return parts !== null && parts.tenantId === ctx.tenantId;
}

/** Title visible to the caller (primary key when the title prop is hidden). */
export function visibleTitle(
  ctx: CallCtx,
  type: CompiledObjectType | undefined,
  o: Pick<StoredObject, 'title' | 'primaryKey'>,
): string {
  if (type && hiddenPropNames(ctx, type).has(type.titleProperty)) {
    return o.primaryKey;
  }
  return o.title;
}

/** Maps a stored object to its DTO, applying the caller's markings. */
export function toObjectDto(
  ctx: CallCtx,
  model: CompiledModel,
  o: StoredObject,
): ObjectDto {
  const type = model.objectTypes[o.type];
  const v = filterByMarkings(ctx, type, o.props, o.provenance);
  return {
    rid: o.rid,
    type: o.type,
    primaryKey: o.primaryKey,
    title: visibleTitle(ctx, type, o),
    props: v.props,
    provenance: v.provenance,
    version: o.version,
    schemaVersion: o.schemaVersion,
    updatedAt: new Date(o.updatedAt).toISOString(),
    ...(v.hiddenProps.length ? {hiddenProps: v.hiddenProps} : {}),
  };
}

/** Indexed property values of an object (graph projection payload). */
export function indexedValues(
  type: CompiledObjectType,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const idx: Record<string, unknown> = {};
  for (const p of type.indexedProps) {
    if (props[p] !== undefined && props[p] !== null) idx[p] = props[p];
  }
  return idx;
}

/** Builds a situation-events outbox event. */
export function situationEvent(
  tenantId: string,
  now: Date,
  body: Omit<SituationEventMsg, 'eventId' | 'tenantId' | 'occurredAt'>,
): OutboxEvent {
  const eventId = ulid(now.getTime());
  return {
    id: eventId,
    tenantId,
    type: body.kind,
    topic: 'situation-events',
    occurredAt: now.getTime(),
    payload: {eventId, tenantId, occurredAt: now.toISOString(), ...body},
  };
}

/** Builds a graph-sync outbox event. */
export function graphSyncEvent(
  tenantId: string,
  now: Date,
  msg: Omit<GraphSyncMsg, 'tenantId'>,
): OutboxEvent {
  return {
    id: ulid(now.getTime()),
    tenantId,
    type: 'GraphSync',
    topic: 'graph-sync',
    occurredAt: now.getTime(),
    payload: {tenantId, ...msg},
  };
}

/** Change entry for a situation event. */
export function objectChange(
  o: StoredObject,
  changed: Iterable<string>,
): ObjectChange {
  return {
    rid: o.rid,
    type: o.type,
    title: o.title,
    changed: [...changed],
    after: o.props,
  };
}

/** Whether both ends of a link type are projected into the graph. */
export function linkProjected(model: CompiledModel, linkType: string): boolean {
  const lt = model.linkTypes[linkType];
  if (!lt) return false;
  return Boolean(
    model.objectTypes[lt.from]?.graphProjected &&
    model.objectTypes[lt.to]?.graphProjected,
  );
}

/** Splits an array into chunks. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
