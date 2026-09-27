/**
 * @fileoverview Passkeys with the browser's native WebAuthn API (no
 * library; admin only, 前端详细设计 6.3.7). The server sends
 * `PublicKeyCredential*OptionsJSON` (as produced by @simplewebauthn/server)
 * and expects `RegistrationResponseJSON` / `AuthenticationResponseJSON`;
 * this module converts between JSON (base64url) and ArrayBuffers.
 */

type Json = Record<string, unknown>;

/** Why a passkey ceremony failed. */
export type PasskeyFailure = 'unsupported' | 'cancelled' | 'failed';

/** Error thrown by {@link createPasskey} / {@link getPasskey}. */
export class PasskeyError extends Error {
  constructor(
    readonly reason: PasskeyFailure,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'PasskeyError';
  }
}

/** Encodes bytes as base64url without padding. */
export function bufferToBase64url(buf: ArrayBuffer | ArrayBufferView): string {
  const bytes = ArrayBuffer.isView(buf)
    ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes base64url (padding optional) into an ArrayBuffer. */
export function base64urlToBuffer(value: string): ArrayBuffer {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Whether this browser can use passkeys. */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials?.create &&
    !!navigator.credentials?.get
  );
}

function unwrap(json: Json): Json {
  return (json.publicKey as Json | undefined) ?? json;
}

function descriptors(
  list: unknown,
): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map(d => {
    const x = d as {id: string; type?: string; transports?: string[]};
    return {
      id: base64urlToBuffer(x.id),
      type: 'public-key',
      ...(x.transports
        ? {transports: x.transports as AuthenticatorTransport[]}
        : {}),
    };
  });
}

/** Converts creation options JSON for `navigator.credentials.create`. */
export function toCreationOptions(
  json: Json,
): PublicKeyCredentialCreationOptions {
  const o = unwrap(json);
  const user = o.user as {id: string; name: string; displayName: string};
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64urlToBuffer(o.challenge as string),
    user: {...user, id: base64urlToBuffer(user.id)},
    excludeCredentials: descriptors(o.excludeCredentials),
  };
}

/** Converts request options JSON for `navigator.credentials.get`. */
export function toRequestOptions(
  json: Json,
): PublicKeyCredentialRequestOptions {
  const o = unwrap(json);
  return {
    ...(o as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64urlToBuffer(o.challenge as string),
    allowCredentials: descriptors(o.allowCredentials),
    userVerification:
      (o.userVerification as UserVerificationRequirement | undefined) ??
      'required',
  };
}

function b64(v: ArrayBuffer | null | undefined): string | undefined {
  return v ? bufferToBase64url(v) : undefined;
}

/** Serializes a credential (registration or assertion) to JSON. */
export function credentialToJson(cred: PublicKeyCredential): Json {
  const r = cred.response as AuthenticatorResponse & {
    attestationObject?: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
    getTransports?: () => string[];
  };
  const response: Json = {clientDataJSON: b64(r.clientDataJSON)};
  if (r.attestationObject) {
    response.attestationObject = b64(r.attestationObject);
    response.transports = r.getTransports?.() ?? [];
  } else {
    response.authenticatorData = b64(r.authenticatorData);
    response.signature = b64(r.signature);
    const uh = b64(r.userHandle ?? undefined);
    if (uh) response.userHandle = uh;
  }
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    ...(cred.authenticatorAttachment
      ? {authenticatorAttachment: cred.authenticatorAttachment}
      : {}),
  };
}

function classify(e: unknown): PasskeyError {
  if (e instanceof PasskeyError) return e;
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError')
    return new PasskeyError('cancelled', name);
  if (name === 'NotSupportedError')
    return new PasskeyError('unsupported', name);
  return new PasskeyError('failed', e instanceof Error ? e.message : String(e));
}

/** Registers a new passkey; returns the registration response JSON. */
export async function createPasskey(
  optionsJson: Json,
  signal?: AbortSignal,
): Promise<Json> {
  if (!isWebAuthnSupported()) throw new PasskeyError('unsupported');
  try {
    const cred = (await navigator.credentials.create({
      publicKey: toCreationOptions(optionsJson),
      signal,
    })) as PublicKeyCredential | null;
    if (!cred) throw new PasskeyError('cancelled');
    return credentialToJson(cred);
  } catch (e) {
    throw classify(e);
  }
}

/** Performs a passkey assertion (user verification required). */
export async function getPasskey(
  optionsJson: Json,
  signal?: AbortSignal,
): Promise<Json> {
  if (!isWebAuthnSupported()) throw new PasskeyError('unsupported');
  try {
    const cred = (await navigator.credentials.get({
      publicKey: toRequestOptions(optionsJson),
      signal,
    })) as PublicKeyCredential | null;
    if (!cred) throw new PasskeyError('cancelled');
    return credentialToJson(cred);
  } catch (e) {
    throw classify(e);
  }
}
