/**
 * @fileoverview Keyed hashing and encryption of personal data: e-mail HMAC
 * (uniqueness without plaintext), AES-GCM e-mail ciphertext, code / IP /
 * recovery-code HMACs. Only identity-access holds the keys.
 */

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  constantTimeEqual,
  hmacSha256Hex,
  sha256Hex,
} from '@ontodecide/shared-kernel';
import {normalizeEmail} from '../domain';

/** Keyed hashing and e-mail encryption. */
export class Secrets {
  constructor(
    private readonly pepper: string,
    private readonly encKey: string,
  ) {}

  /** HMAC of the normalized e-mail. */
  emailHmac(email: string): Promise<string> {
    return hmacSha256Hex(this.pepper, `email:${normalizeEmail(email)}`);
  }

  /** AES-GCM ciphertext of the normalized e-mail. */
  encryptEmail(email: string): Promise<string> {
    return aesGcmEncrypt(this.encKey, normalizeEmail(email));
  }

  decryptEmail(sealed: string): Promise<string> {
    return aesGcmDecrypt(this.encKey, sealed);
  }

  /** HMAC(pepper, e-mail + code); purpose-bound. */
  codeHmac(email: string, purpose: string, code: string): Promise<string> {
    return hmacSha256Hex(
      this.pepper,
      `code:${purpose}:${normalizeEmail(email)}:${code}`,
    );
  }

  /** HMAC of an IP address (only used for the per-IP sign-up cap). */
  ipHmac(ip: string): Promise<string> {
    return hmacSha256Hex(this.pepper, `ip:${ip}`);
  }

  /** HMAC of a normalized recovery code. */
  recoveryHash(normalized: string): Promise<string> {
    return hmacSha256Hex(this.pepper, `recovery:${normalized}`);
  }
}

/** Constant-time comparison of two secrets of any length. */
export async function secretEquals(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return constantTimeEqual(ha, hb);
}
