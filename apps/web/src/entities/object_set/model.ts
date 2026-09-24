/**
 * @fileoverview Object Set helpers shared across pages.
 */

import type {ObjectSetDef, OrderBy} from '@ontodecide/shared-kernel';

/** Serializes an order clause for the `orderBy=<prop:dir>` query param. */
export function orderByParam(order: OrderBy | undefined): string | undefined {
  return order ? `${order.prop}:${order.dir}` : undefined;
}

/** Parses `prop:dir`. */
export function parseOrderBy(value: string | undefined): OrderBy | undefined {
  if (!value) return undefined;
  const [prop, dir] = value.split(':');
  if (!prop) return undefined;
  return {prop, dir: dir === 'desc' ? 'desc' : 'asc'};
}

/** Builds an Object Set definition from list state. */
export function toObjectSetDef(
  objectType: string,
  filter: ObjectSetDef['filter'],
  order?: OrderBy,
): ObjectSetDef {
  return {
    objectType,
    ...(filter ? {filter} : {}),
    ...(order ? {orderBy: [order]} : {}),
  };
}
