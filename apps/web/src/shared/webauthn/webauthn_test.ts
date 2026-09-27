/**
 * @fileoverview Native WebAuthn helpers: base64url, options conversion,
 * credential JSON, error classification, step-up.
 */

import {afterEach, describe, expect, it} from 'vitest';
import {installWebAuthn, removeWebAuthn} from '../../test/webauthn_mock';
import {recorded} from '../../test/handlers/platform';
import {configureApi} from '../api/client';
import {requestStepUp} from './step_up';
import {
  base64urlToBuffer,
  bufferToBase64url,
  createPasskey,
  getPasskey,
  isWebAuthnSupported,
  PasskeyError,
  toCreationOptions,
  toRequestOptions,
} from './webauthn';

afterEach(() => removeWebAuthn());

describe('webauthn helpers', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255]);
    const s = bufferToBase64url(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(new Uint8Array(base64urlToBuffer(s))).toEqual(bytes);
  });

  it('converts options JSON to ArrayBuffers', () => {
    const c = toCreationOptions({
      challenge: 'YWJj',
      rp: {name: 'x'},
      user: {id: 'dQ', name: 'a', displayName: 'a'},
      pubKeyCredParams: [],
      excludeCredentials: [{id: 'eA', type: 'public-key'}],
    });
    expect(new Uint8Array(c.challenge as ArrayBuffer)).toEqual(
      new Uint8Array([97, 98, 99]),
    );
    expect(c.user.id).toBeInstanceOf(ArrayBuffer);
    expect(c.excludeCredentials?.[0].id).toBeInstanceOf(ArrayBuffer);
    const r = toRequestOptions({publicKey: {challenge: 'YWJj'}});
    expect(r.userVerification).toBe('required');
  });

  it('serializes registration and assertion responses', async () => {
    installWebAuthn();
    expect(isWebAuthnSupported()).toBe(true);
    const reg = await createPasskey({
      challenge: 'YWJj',
      rp: {name: 'x'},
      user: {id: 'dQ', name: 'a', displayName: 'a'},
      pubKeyCredParams: [],
    });
    expect(reg).toMatchObject({id: 'Y3JlZDE', type: 'public-key'});
    expect(
      (reg.response as Record<string, unknown>).attestationObject,
    ).toBeTypeOf('string');
    const asr = await getPasskey({challenge: 'YWJj'});
    expect(Object.keys(asr.response as object)).toEqual(
      expect.arrayContaining([
        'clientDataJSON',
        'authenticatorData',
        'signature',
        'userHandle',
      ]),
    );
  });

  it('classifies cancellation and missing support', async () => {
    installWebAuthn({failGet: true});
    await expect(getPasskey({challenge: 'YWJj'})).rejects.toMatchObject({
      reason: 'cancelled',
    });
    removeWebAuthn();
    expect(isWebAuthnSupported()).toBe(false);
    await expect(getPasskey({challenge: 'YWJj'})).rejects.toBeInstanceOf(
      PasskeyError,
    );
  });

  it('runs the step-up ceremony and returns the token', async () => {
    installWebAuthn();
    configureApi({getToken: () => 'tok', getActAs: () => 'ws-x'});
    await expect(requestStepUp()).resolves.toBe('su-1');
    const [opt] = recorded('POST', '/auth/passkeys/options');
    expect(opt.body).toEqual({purpose: 'step_up'});
    expect(opt.headers['x-act-as-tenant']).toBeUndefined();
    expect(recorded('POST', '/auth/passkeys/assertion')[0].body).toMatchObject({
      purpose: 'step_up',
    });
  });
});
