/**
 * @fileoverview Identifier helpers: ULIDs and resource identifiers (RIDs).
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generates a ULID (26 chars, lexicographically sortable by time). */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand += CROCKFORD[bytes[i] % 32];
  }
  return time + rand;
}

/** Resource identifier: `ri.<tenant>.<objectType>.<ulid>`. */
export type Rid = `ri.${string}.${string}.${string}`;

/** Builds a new RID for an object of the given type. */
export function newRid(
  tenantId: string,
  objectType: string,
  now?: number,
): Rid {
  return `ri.${tenantId}.${objectType}.${ulid(now)}`;
}

/** Parsed parts of a RID. */
export interface RidParts {
  tenantId: string;
  objectType: string;
  id: string;
}

/** Parses a RID, returning null when malformed. */
export function parseRid(value: string): RidParts | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'ri') return null;
  const [, tenantId, objectType, id] = parts;
  if (!tenantId || !objectType || !id) return null;
  return {tenantId, objectType, id};
}

/** Whether a string is a well-formed RID. */
export function isRid(value: unknown): value is Rid {
  return typeof value === 'string' && parseRid(value) !== null;
}
