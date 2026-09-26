/**
 * @fileoverview Stable hash of an object's properties; unchanged records
 * skip the write.
 */

import {canonicalJson, sha256Hex} from '@ontodecide/shared-kernel';

/** SHA-256 (hex) of the canonical JSON of the properties. */
export function propsHash(props: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalJson(props));
}
