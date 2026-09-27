/**
 * @fileoverview Tests of Ed25519 JWT signing, verification and key rotation.
 */

import {describe, expect, it} from 'vitest';
import {AppError} from './errors';
import {
  generateSigningKey,
  parsePublicKeys,
  parseSigningKey,
  publicJwkOf,
  signJwt,
  verifyJwt,
} from './jwt';

describe('jwt (Ed25519)', () => {
  it('signs with the private key and verifies with the public set', async () => {
    const key = await generateSigningKey('2026-09');
    const pub = parsePublicKeys(JSON.stringify({keys: [publicJwkOf(key)]}));
    expect(pub[0].d).toBeUndefined();
    const token = await signJwt({sub: 'u1', exp: 2_000_000_000}, key);
    const header = JSON.parse(
      atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(header).toMatchObject({alg: 'EdDSA', kid: '2026-09'});
    expect(await verifyJwt(token, pub, 1_000)).toMatchObject({sub: 'u1'});
  });

  it('accepts old and new keys during rotation', async () => {
    const oldKey = await generateSigningKey('old');
    const newKey = await generateSigningKey('new');
    const pub = [publicJwkOf(newKey), publicJwkOf(oldKey)];
    const t = await signJwt({exp: 2_000_000_000}, oldKey);
    await expect(verifyJwt(t, pub, 1)).resolves.toBeTruthy();
  });

  it('rejects tampering, unknown kids and expiry', async () => {
    const key = await generateSigningKey('k');
    const other = await generateSigningKey('k');
    const pub = [publicJwkOf(key)];
    const token = await signJwt({sub: 'u1', exp: 100}, key);
    const [h, , s] = token.split('.');
    const forged = `${h}.${btoa('{"sub":"admin","exp":9999999999}').replace(/=+$/, '')}.${s}`;
    await expect(verifyJwt(forged, pub, 1)).rejects.toThrow(AppError);
    await expect(
      verifyJwt(await signJwt({exp: 100}, other), pub, 1),
    ).rejects.toMatchObject({code: 'UNAUTHENTICATED'});
    await expect(
      verifyJwt(await signJwt({exp: 100}, {...key, kid: 'x'}), pub, 1),
    ).rejects.toMatchObject({code: 'UNAUTHENTICATED'});
    await expect(verifyJwt(token, pub, 100)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(verifyJwt('a.b', pub, 1)).rejects.toThrow(AppError);
  });

  it('validates the signing key secret', () => {
    expect(() => parseSigningKey(undefined)).toThrow(AppError);
    expect(() =>
      parseSigningKey('{"kty":"OKP","crv":"Ed25519","x":"a","kid":"k"}'),
    ).toThrow(AppError);
  });
});
