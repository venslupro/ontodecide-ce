/**
 * @fileoverview Fake `navigator.credentials` + `PublicKeyCredential` for
 * passkey tests (jsdom has no WebAuthn).
 */

import {vi} from 'vitest';

function buf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

/** A fake credential of the given kind. */
export function fakeCredential(kind: 'create' | 'get', id = 'Y3JlZDE') {
  const response =
    kind === 'create'
      ? {
          clientDataJSON: buf('{"type":"webauthn.create"}'),
          attestationObject: buf('att'),
          getTransports: () => ['internal'],
        }
      : {
          clientDataJSON: buf('{"type":"webauthn.get"}'),
          authenticatorData: buf('auth'),
          signature: buf('sig'),
          userHandle: buf('user'),
        };
  return {
    id,
    rawId: buf('cred1'),
    type: 'public-key',
    response,
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
  };
}

/** Installs WebAuthn fakes; returns the create / get spies. */
export function installWebAuthn(opts: {failGet?: boolean} = {}) {
  const create = vi.fn(async () => fakeCredential('create'));
  const get = vi.fn(async () => {
    if (opts.failGet) throw new DOMException('cancelled', 'NotAllowedError');
    return fakeCredential('get');
  });
  (window as unknown as {PublicKeyCredential: unknown}).PublicKeyCredential =
    function PublicKeyCredential() {};
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {create, get},
  });
  return {create, get};
}

/** Removes WebAuthn support. */
export function removeWebAuthn(): void {
  delete (window as unknown as {PublicKeyCredential?: unknown})
    .PublicKeyCredential;
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: undefined,
  });
}
