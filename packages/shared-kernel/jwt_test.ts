import {describe, expect, it} from 'vitest';
import {AppError} from './errors';
import {parseJwtKeys, signJwt, verifyJwt} from './jwt';

describe('jwt', () => {
  const keys = parseJwtKeys('k2:new-secret,k1:old-secret');

  it('parses bare and kid-prefixed secrets', () => {
    expect(parseJwtKeys('plain')).toEqual([{kid: 'k1', secret: 'plain'}]);
    expect(keys.map(k => k.kid)).toEqual(['k2', 'k1']);
    expect(() => parseJwtKeys(undefined)).toThrow(AppError);
  });

  it('signs with the first key and verifies with any key', async () => {
    const token = await signJwt({sub: 'u1', exp: 2_000_000_000}, keys);
    const header = JSON.parse(
      atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(header).toMatchObject({alg: 'HS256', kid: 'k2'});
    expect(
      (await verifyJwt<{sub: string; exp?: number}>(token, keys)).sub,
    ).toBe('u1');
    const old = await signJwt({sub: 'u2'}, [keys[1]]);
    expect((await verifyJwt<{sub: string; exp?: number}>(old, keys)).sub).toBe(
      'u2',
    );
  });

  it('rejects tampered, unknown-kid and expired tokens', async () => {
    const token = await signJwt({sub: 'u1', exp: 100}, keys);
    await expect(verifyJwt(token, keys, 99)).resolves.toMatchObject({
      sub: 'u1',
    });
    await expect(verifyJwt(token, keys, 100)).rejects.toMatchObject({
      code: 'AUTH_EXPIRED',
    });
    const [h, , s] = token.split('.');
    const forged = `${h}.${btoa(JSON.stringify({sub: 'admin', exp: 9e9})).replace(/=+$/, '')}.${s}`;
    await expect(verifyJwt(forged, keys, 1)).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
    await expect(
      verifyJwt(token, parseJwtKeys('k9:x'), 1),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
    await expect(verifyJwt('garbage', keys)).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
  });
});
