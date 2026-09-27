/**
 * @fileoverview Admin second-factor rules (修订说明书 6.4, 12.3): ≥ 2
 * passkeys, 10 one-time recovery codes, sign-count regression rejected.
 */

import {base64urlDecode, fromUtf8} from '@ontodecide/shared-kernel';

/** Admin passkey rules. */
export const PASSKEY_RULES = {
  /** Passkeys that must remain after a deletion. */
  minPasskeys: 2,
  recoveryCodes: 10,
} as const;

/** system_flag key recording that the bootstrap setup code was consumed. */
export const SETUP_CODE_USED_FLAG = 'setup_code_used';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generates one recovery code `XXXX-XXXX-XXXX` (60 bits). */
export function generateRecoveryCode(
  random: (n: number) => Uint8Array = n =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = random(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[bytes[i] % 32];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** Canonical form of a typed recovery code (case and separators ignored). */
export function normalizeRecoveryCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/**
 * Extracts the challenge from a WebAuthn credential's clientDataJSON
 * (base64url). Null when the credential is malformed.
 */
export function challengeOf(
  credential: Record<string, unknown>,
): string | null {
  const response = credential['response'] as
    {clientDataJSON?: unknown} | undefined;
  const raw = response?.clientDataJSON;
  if (typeof raw !== 'string') return null;
  try {
    const data = JSON.parse(fromUtf8(base64urlDecode(raw))) as {
      challenge?: unknown;
    };
    return typeof data.challenge === 'string' ? data.challenge : null;
  } catch {
    return null;
  }
}

/** Credential id of a WebAuthn response (null when missing). */
export function credentialIdOf(
  credential: Record<string, unknown>,
): string | null {
  const id = credential['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Whether an authenticator's new signature counter is acceptable. A
 * counter that does not increase (while either value is non-zero) points to
 * a cloned authenticator.
 */
export function signCountOk(stored: number, next: number): boolean {
  if (stored === 0 && next === 0) return true;
  return next > stored;
}
