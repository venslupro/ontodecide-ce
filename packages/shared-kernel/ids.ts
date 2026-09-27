/**
 * @fileoverview Identifier helpers: ULIDs and resource identifiers (RIDs).
 *
 * RIDs follow `ri.<objectType>.<ulid>` (修订说明书 12.2). They carry no
 * tenant id and no personal data; isolation comes from `tenant_id` columns.
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

/** Resource identifier `ri.<objectType>.<ulid>`. */
export type Rid = `ri.${string}.${string}`;

/** Builds a new RID for an object of the given type. */
export function newRid(objectType: string, now?: number): Rid {
  return `ri.${objectType}.${ulid(now)}`;
}

/** Parsed parts of a RID. */
export interface RidParts {
  objectType: string;
  id: string;
}

/** Parses a RID, returning null when malformed. */
export function parseRid(value: string): RidParts | null {
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== 'ri') return null;
  const [, objectType, id] = parts;
  if (!objectType || !id) return null;
  return {objectType, id};
}

/** Whether a string is a well-formed RID. */
export function isRid(value: unknown): value is Rid {
  return typeof value === 'string' && parseRid(value) !== null;
}

/** Whether a string looks like a ULID (tenant and user ids). */
export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
