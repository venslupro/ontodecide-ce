import {describe, expect, it} from 'vitest';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64url,
  base64urlDecode,
  constantTimeEqual,
  hmacSha256Hex,
  pbkdf2,
  sha256Hex,
} from './crypto';
import {canonicalJson, parseJson} from './json';

describe('crypto', () => {
  it('base64url round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 250, 1]);
    expect(base64urlDecode(base64url(bytes))).toEqual(bytes);
    expect(base64url(bytes)).not.toMatch(/[+/=]/);
  });

  it('hashes and HMACs deterministically', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'),
    ).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('derives PBKDF2 hashes that depend on salt and password', async () => {
    const salt = new Uint8Array(16).fill(1);
    const a = await pbkdf2('pw', salt, 1000);
    expect(await pbkdf2('pw', salt, 1000)).toBe(a);
    expect(await pbkdf2('pw2', salt, 1000)).not.toBe(a);
    expect(await pbkdf2('pw', new Uint8Array(16), 1000)).not.toBe(a);
  });

  it('encrypts with AES-GCM using a random IV', async () => {
    const a = await aesGcmEncrypt('k', 'secret header');
    const b = await aesGcmEncrypt('k', 'secret header');
    expect(a).not.toBe(b);
    expect(await aesGcmDecrypt('k', a)).toBe('secret header');
    await expect(aesGcmDecrypt('other', a)).rejects.toThrow();
  });

  it('compares in constant time and serializes canonically', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
    expect(canonicalJson({b: 1, a: {d: [2, {z: 1, y: 2}], c: undefined}})).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
    expect(parseJson('nope', 7)).toBe(7);
    expect(parseJson(null, [])).toEqual([]);
  });
});
