/**
 * @fileoverview WebAuthnPort adapters: @simplewebauthn/server v13 (rpID
 * WEBAUTHN_RP_ID, origin APP_ORIGIN, user verification required) and a
 * deterministic fake for tests and the in-process harness.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  base64url,
  base64urlDecode,
  fromUtf8,
  randomToken,
  utf8,
} from '@ontodecide/shared-kernel';
import type {
  PasskeyRecord,
  VerifiedRegistration,
  WebAuthnPort,
} from '../application';

/** Relying party settings. */
export interface RelyingParty {
  rpId: string;
  rpName: string;
  origin: string;
}

const asTransports = (t: string[]) => t as AuthenticatorTransportFuture[];

/** @simplewebauthn/server adapter. */
export class SimpleWebAuthn implements WebAuthnPort {
  constructor(private readonly rp: RelyingParty) {}

  async registrationOptions(opts: {
    userId: string;
    userName: string;
    exclude: {id: string; transports: string[]}[];
  }) {
    const options = await generateRegistrationOptions({
      rpName: this.rp.rpName,
      rpID: this.rp.rpId,
      userName: opts.userName,
      userID: utf8(opts.userId),
      attestationType: 'none',
      excludeCredentials: opts.exclude.map(e => ({
        id: e.id,
        transports: asTransports(e.transports),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    return {
      options: options as unknown as Record<string, unknown>,
      challenge: options.challenge,
    };
  }

  async verifyRegistration(
    response: Record<string, unknown>,
    expectedChallenge: string,
  ): Promise<VerifiedRegistration | null> {
    try {
      const v = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.rpId,
        requireUserVerification: true,
      });
      if (!v.verified) return null;
      const c = v.registrationInfo.credential;
      return {
        credentialId: c.id,
        publicKey: base64url(c.publicKey),
        counter: c.counter,
        transports: c.transports ?? [],
      };
    } catch {
      return null;
    }
  }

  async authenticationOptions(opts: {
    allow: {id: string; transports: string[]}[];
  }) {
    const options = await generateAuthenticationOptions({
      rpID: this.rp.rpId,
      allowCredentials: opts.allow.map(a => ({
        id: a.id,
        transports: asTransports(a.transports),
      })),
      userVerification: 'required',
    });
    return {
      options: options as unknown as Record<string, unknown>,
      challenge: options.challenge,
    };
  }

  async verifyAuthentication(
    response: Record<string, unknown>,
    expectedChallenge: string,
    credential: PasskeyRecord,
  ): Promise<{newCounter: number} | null> {
    try {
      const v = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: base64urlDecode(credential.publicKey),
          counter: credential.signCount,
          transports: asTransports(credential.transports),
        },
        requireUserVerification: true,
      });
      return v.verified ? {newCounter: v.authenticationInfo.newCounter} : null;
    } catch {
      return null;
    }
  }
}

/** Test data carried by a fake credential. */
interface FakePayload {
  publicKey: string;
  counter: number;
  userVerified: boolean;
}

function clientData(challenge: string, type: string): string {
  return base64url(
    utf8(JSON.stringify({type, challenge, origin: 'https://app.test'})),
  );
}

function readClient(response: Record<string, unknown>): {challenge?: string} {
  const r = response['response'] as {clientDataJSON?: string} | undefined;
  try {
    return JSON.parse(fromUtf8(base64urlDecode(r?.clientDataJSON ?? '')));
  } catch {
    return {};
  }
}

/**
 * Deterministic WebAuthn fake: a "credential" is JSON carrying the
 * challenge in clientDataJSON plus `fake: {publicKey, counter,
 * userVerified}`. Signature checks become "public key matches".
 */
export class FakeWebAuthn implements WebAuthnPort {
  async registrationOptions(opts: {userId: string}) {
    const challenge = randomToken(16);
    return {options: {challenge, user: {id: opts.userId}}, challenge};
  }

  async verifyRegistration(
    response: Record<string, unknown>,
    expectedChallenge: string,
  ) {
    const fake = response['fake'] as FakePayload | undefined;
    if (!fake || readClient(response).challenge !== expectedChallenge)
      return null;
    if (!fake.userVerified) return null;
    return {
      credentialId: String(response['id']),
      publicKey: fake.publicKey,
      counter: fake.counter,
      transports: ['internal'],
    };
  }

  async authenticationOptions() {
    const challenge = randomToken(16);
    return {options: {challenge}, challenge};
  }

  async verifyAuthentication(
    response: Record<string, unknown>,
    expectedChallenge: string,
    credential: PasskeyRecord,
  ) {
    const fake = response['fake'] as FakePayload | undefined;
    if (!fake || readClient(response).challenge !== expectedChallenge)
      return null;
    if (!fake.userVerified || fake.publicKey !== credential.publicKey)
      return null;
    return {newCounter: fake.counter};
  }

  /** Builds a fake registration or assertion response for a challenge. */
  static credential(
    id: string,
    challenge: string,
    opts: {
      publicKey?: string;
      counter?: number;
      userVerified?: boolean;
      type?: 'create' | 'get';
    } = {},
  ): Record<string, unknown> {
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: clientData(challenge, `webauthn.${opts.type ?? 'get'}`),
      },
      fake: {
        publicKey: opts.publicKey ?? `pk-${id}`,
        counter: opts.counter ?? 0,
        userVerified: opts.userVerified ?? true,
      } satisfies FakePayload,
    };
  }
}
