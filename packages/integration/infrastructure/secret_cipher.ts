/**
 * @fileoverview AES-GCM encryption of connector secrets.
 */

import {aesGcmDecrypt, aesGcmEncrypt} from '@ontodecide/shared-kernel';
import type {Logger} from '@ontodecide/shared-kernel';
import type {SecretCipher, SourceSecrets} from '../application';

/** Key used when CONNECTOR_ENC_KEY is not configured (local dev only). */
export const DEV_CONNECTOR_KEY = 'ontodecide-ce-dev-connector-key';

/** Seals secrets as `iv.ciphertext` with a key derived from the secret. */
export class AesSecretCipher implements SecretCipher {
  private readonly key: string;

  constructor(key: string | undefined, logger?: Logger) {
    if (!key) {
      logger?.warn('CONNECTOR_ENC_KEY is not set; using the development key');
    }
    this.key = key || DEV_CONNECTOR_KEY;
  }

  async seal(secrets: SourceSecrets): Promise<string> {
    return aesGcmEncrypt(this.key, JSON.stringify(secrets));
  }

  async open(sealed: string): Promise<SourceSecrets> {
    return JSON.parse(await aesGcmDecrypt(this.key, sealed)) as SourceSecrets;
  }
}
