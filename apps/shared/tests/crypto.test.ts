/**
 * Unit tests for JWT and crypto utilities.
 *
 * These cover the core security primitives used by the Gateway (signing
 * access tokens) and the User service (password hashing).
 */
import {describe, it, expect, beforeAll} from 'vitest';
import {
  signJwt,
  verifyJwt,
} from '../src/utils/jwt.js';
import {
  hashPassword,
  verifyPassword,
  generateTemporaryPassword,
  hmacSign,
  hmacVerify,
  base64url,
  base64urlDecode,
  constantTimeEqual,
  sha256Hex,
} from '../src/utils/crypto.js';
import type {JwtPayload} from '../src/types/user.js';

const TEST_SECRET = 'test-secret-please-do-not-use-in-prod';

describe('hashPassword / verifyPassword', () => {
  it('hashes a password and verifies it', async () => {
    const hash = await hashPassword('MyPassword123');
    expect(hash).toMatch(/^pbkdf2\$\d+\$/);
    expect(await verifyPassword('MyPassword123', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });

  it('returns false for a malformed stored hash', async () => {
    expect(await verifyPassword('pw', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('pw', 'pbkdf2$abc')).toBe(false);
  });
});

describe('generateTemporaryPassword', () => {
  it('generates a 16-character alphanumeric string', () => {
    const pw = generateTemporaryPassword();
    expect(pw).toHaveLength(16);
  });

  it('generates different values on subsequent calls', () => {
    const pw1 = generateTemporaryPassword();
    const pw2 = generateTemporaryPassword();
    expect(pw1).not.toBe(pw2);
  });

  it('excludes ambiguous characters (0, O, I, l)', () => {
    // Run several times to be confident.
    for (let i = 0; i < 50; i++) {
      const pw = generateTemporaryPassword();
      expect(pw).not.toMatch(/[0OIl]/);
    }
  });
});

describe('hmacSign / hmacVerify', () => {
  it('signs and verifies a message', async () => {
    const sig = await hmacSign(TEST_SECRET, 'hello world');
    expect(await hmacVerify(TEST_SECRET, 'hello world', sig)).toBe(true);
  });

  it('rejects a tampered message', async () => {
    const sig = await hmacSign(TEST_SECRET, 'message');
    expect(await hmacVerify(TEST_SECRET, 'tampered', sig)).toBe(false);
  });

  it('rejects a different secret', async () => {
    const sig = await hmacSign(TEST_SECRET, 'msg');
    expect(await hmacVerify('different-secret', 'msg', sig)).toBe(false);
  });
});

describe('base64url / base64urlDecode', () => {
  it('round-trips a byte array', () => {
    const input = new TextEncoder().encode('Hello, World!');
    const encoded = base64url(input);
    const decoded = base64urlDecode(encoded);
    expect(new TextDecoder().decode(decoded)).toBe('Hello, World!');
  });

  it('produces URL-safe output (no +, /, =)', () => {
    const encoded = base64url(new Uint8Array([255, 254, 253]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns false for same-length different strings', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('produces a deterministic 64-char hex digest', async () => {
    const digest = await sha256Hex('test');
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]+$/);
    // Known SHA-256 of "test"
    expect(digest).toBe(
        '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });
});

describe('signJwt / verifyJwt', () => {
  const payload: Omit<JwtPayload, 'iat'> = {
    user_id: 'u123',
    tenant_id: 'tenant_abc',
    username: 'alice',
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: 'jti-abc',
  };

  it('signs a payload and verifies it round-trip', async () => {
    const token = await signJwt(payload, TEST_SECRET);
    expect(token.split('.')).toHaveLength(3);
    const verified = await verifyJwt(token, TEST_SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.user_id).toBe('u123');
    expect(verified!.username).toBe('alice');
    expect(verified!.jti).toBe('jti-abc');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signJwt(payload, TEST_SECRET);
    const verified = await verifyJwt(token, 'wrong-secret');
    expect(verified).toBeNull();
  });

  it('rejects an expired token', async () => {
    const expiredPayload = {
      ...payload,
      exp: Math.floor(Date.now() / 1000) - 1,
    };
    const token = await signJwt(expiredPayload, TEST_SECRET);
    expect(await verifyJwt(token, TEST_SECRET)).toBeNull();
  });

  it('rejects a malformed token (not 3 segments)', async () => {
    expect(await verifyJwt('not-a-jwt', TEST_SECRET)).toBeNull();
  });

  it('rejects a token with a tampered payload', async () => {
    const token = await signJwt(payload, TEST_SECRET);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.tampered`;
    expect(await verifyJwt(tampered, TEST_SECRET)).toBeNull();
  });

  it('honours the blacklist function for revoked jtis', async () => {
    const token = await signJwt(payload, TEST_SECRET);
    const verified = await verifyJwt(
        token, TEST_SECRET,
        async (jti) => jti === 'jti-abc',
    );
    expect(verified).toBeNull();
  });

  it('allows a non-revoked jti', async () => {
    const token = await signJwt(payload, TEST_SECRET);
    const verified = await verifyJwt(
        token, TEST_SECRET,
        async () => false,
    );
    expect(verified).not.toBeNull();
  });
});
