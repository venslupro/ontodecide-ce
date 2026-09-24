/**
 * @fileoverview PBKDF2-SHA256 password hasher. `pwd_salt` holds the
 * base64url 16-byte salt; `pwd_hash` holds `<iterations>$<base64url hash>`
 * so the iteration count can be raised without invalidating old hashes.
 */

import {
  PBKDF2_ITERATIONS,
  base64url,
  base64urlDecode,
  constantTimeEqual,
  pbkdf2,
  randomBytes,
} from '@ontodecide/shared-kernel';
import type {PasswordHash, PasswordHasher} from '../application';

/** Salt length in bytes. */
export const PASSWORD_SALT_BYTES = 16;

/** PBKDF2-SHA256 hasher; iterations are injectable for fast tests. */
export class Pbkdf2PasswordHasher implements PasswordHasher {
  constructor(private readonly iterations: number = PBKDF2_ITERATIONS) {}

  async hash(password: string): Promise<PasswordHash> {
    const salt = randomBytes(PASSWORD_SALT_BYTES);
    const derived = await pbkdf2(password, salt, this.iterations);
    return {hash: `${this.iterations}$${derived}`, salt: base64url(salt)};
  }

  async verify(password: string, stored: PasswordHash): Promise<boolean> {
    const idx = stored.hash.indexOf('$');
    if (idx <= 0) return false;
    const iterations = Number(stored.hash.slice(0, idx));
    if (!Number.isInteger(iterations) || iterations <= 0) return false;
    let salt: Uint8Array<ArrayBuffer>;
    try {
      salt = base64urlDecode(stored.salt);
    } catch {
      return false;
    }
    const derived = await pbkdf2(password, salt, iterations);
    return constantTimeEqual(derived, stored.hash.slice(idx + 1));
  }
}
