/**
 * @fileoverview Contract tests of the external adapters against FetchMock:
 * B2 (S3 API + presign), Turnstile, Resend, Brevo, the log sender and
 * GraphQL Analytics.
 */

import {describe, expect, it} from 'vitest';
import type {Logger} from '@ontodecide/shared-kernel';
import {FetchMock} from '@ontodecide/testing';
import type {EmailMessage} from '../application';
import {B2BlobStore, B2LinkSigner} from './b2_blob_store';
import {CloudflareAnalytics} from './cf_analytics';
import {
  BrevoSender,
  LogEmailSender,
  ResendSender,
  parseMailFrom,
} from './email_senders';
import {
  HttpTurnstileVerifier,
  TURNSTILE_VERIFY_URL,
} from './turnstile_verifier';
import {SimpleWebAuthn} from './webauthn';

const endpoint = {
  endpoint: 's3.us-west-004.backblazeb2.com',
  bucket: 'ontodecide-prd-archive',
  region: 'us-west-004',
};
const key = {keyId: 'kid', appKey: 'secret'};

const msg: EmailMessage = {
  to: 'user@example.com',
  subject: '123456 is your code',
  html: '<p>x</p>',
  text: 'x',
  template: 'code_login',
  priority: 'otp',
};

describe('B2BlobStore', () => {
  it('signs S3 requests against the bucket URL', async () => {
    const f = new FetchMock(call => {
      if (call.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {'content-length': '3'},
        });
      }
      if (call.url.includes('?versions')) {
        return new Response(
          `<ListVersionsResult><IsTruncated>false</IsTruncated>
           <Version><Key>staging/t/0.part</Key><VersionId>v1</VersionId></Version>
           <Version><Key>staging/t/1.part</Key><VersionId>v2</VersionId></Version>
           <DeleteMarker><Key>staging/t/1.part</Key><VersionId>v3</VersionId></DeleteMarker>
           </ListVersionsResult>`,
        );
      }
      if (call.method === 'GET' && call.url.endsWith('missing'))
        return new Response('', {status: 404});
      return new Response('abc');
    });
    const b2 = new B2BlobStore(key, endpoint, f.fetch);
    await b2.put(
      'archives/t/x.zip',
      new Uint8Array([1, 2, 3]),
      'application/zip',
    );
    const put = f.calls[0];
    expect(put.method).toBe('PUT');
    expect(put.url).toBe(
      'https://s3.us-west-004.backblazeb2.com/ontodecide-prd-archive/archives/t/x.zip',
    );
    expect(put.headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=kid\//,
    );
    expect(await b2.head('archives/t/x.zip')).toEqual({size: 3});
    expect(await b2.get('missing')).toBeNull();
    expect(fromBytes(await b2.get('x'))).toBe('abc');
    expect(await b2.deletePrefix('staging/t/')).toBe(3);
    const deletes = f.calls.filter(c => c.method === 'DELETE');
    expect(
      deletes.map(d => new URL(d.url).searchParams.get('versionId')),
    ).toEqual(['v1', 'v2', 'v3']);
    expect(await b2.deleteAllVersions('staging/t/1.part')).toBe(2);
  });

  it('fails with UNAVAILABLE on errors', async () => {
    const f = new FetchMock(() => new Response('', {status: 500}));
    const b2 = new B2BlobStore(key, endpoint, f.fetch);
    await expect(b2.put('k', 'x')).rejects.toThrow(/UNAVAILABLE/);
  });

  it('presigns a 7-day GET with the sign key and a content disposition', async () => {
    const signer = new B2LinkSigner({keyId: 'signkid', appKey: 's'}, endpoint);
    const url = new URL(
      await signer.presignGet(
        'archives/t/r.zip',
        604_800,
        'attachment; filename="ontodecide-archive-2026-09-27.zip"',
      ),
    );
    expect(url.pathname).toBe('/ontodecide-prd-archive/archives/t/r.zip');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('604800');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^signkid\//);
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('response-content-disposition')).toContain(
      'ontodecide-archive-2026-09-27.zip',
    );
  });
});

function fromBytes(b: Uint8Array | null): string {
  return b ? new TextDecoder().decode(b) : '';
}

describe('Turnstile', () => {
  it('posts the secret, token and IP to siteverify', async () => {
    const f = new FetchMock(() => Response.json({success: true}));
    const t = new HttpTurnstileVerifier('sec', f.fetch);
    expect(await t.verify('tok', '1.2.3.4')).toBe(true);
    expect(f.calls[0].url).toBe(TURNSTILE_VERIFY_URL);
    const body = new URLSearchParams(f.calls[0].body);
    expect(Object.fromEntries(body)).toEqual({
      secret: 'sec',
      response: 'tok',
      remoteip: '1.2.3.4',
    });
    f.respond(() => Response.json({success: false}));
    expect(await t.verify('tok', '1.2.3.4')).toBe(false);
    f.respond(() => new Response('', {status: 500}));
    expect(await t.verify('tok', '')).toBe(false);
  });
});

describe('mail providers', () => {
  it('Resend sends the Idempotency-Key header', async () => {
    const f = new FetchMock(() => Response.json({id: 'x'}));
    const r = await new ResendSender(
      'rk',
      'OntoDecide <noreply@mail.test>',
      f.fetch,
    ).send(msg, 'code:k');
    expect(r).toEqual({ok: true, status: 200});
    expect(f.calls[0].url).toBe('https://api.resend.com/emails');
    expect(f.calls[0].headers['idempotency-key']).toBe('code:k');
    expect(f.calls[0].headers['authorization']).toBe('Bearer rk');
    expect(JSON.parse(f.calls[0].body)).toMatchObject({
      from: 'OntoDecide <noreply@mail.test>',
      to: ['user@example.com'],
    });
    f.respond(() => new Response('', {status: 429}));
    expect(await new ResendSender('rk', 'a@b', f.fetch).send(msg, 'k')).toEqual(
      {ok: false, status: 429},
    );
  });

  it('Brevo sends sender, content and the idempotency header', async () => {
    const f = new FetchMock(() =>
      Response.json({messageId: 'x'}, {status: 201}),
    );
    const r = await new BrevoSender('bk', 'noreply@mail.test', f.fetch).send(
      msg,
      'archive:t',
    );
    expect(r.ok).toBe(true);
    expect(f.calls[0].headers['api-key']).toBe('bk');
    const body = JSON.parse(f.calls[0].body);
    expect(body).toMatchObject({
      sender: {email: 'noreply@mail.test'},
      to: [{email: 'user@example.com'}],
      headers: {idempotencyKey: 'archive:t'},
    });
    expect(parseMailFrom('Name <a@b.c>')).toEqual({
      name: 'Name',
      email: 'a@b.c',
    });
  });

  it('the log sender writes one redacted line', async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = {
      info: (_m: string, f?: Record<string, unknown>) => lines.push(f ?? {}),
    } as unknown as Logger;
    await new LogEmailSender(logger, false).send(msg, 'k');
    await new LogEmailSender(logger, true).send(msg, 'k');
    expect(lines[0]).toEqual({
      template: 'code_login',
      to: 'u***@example.com',
      key: expect.any(String),
    });
    expect(JSON.stringify(lines[0])).not.toContain('user@');
    expect(lines[1]['code']).toBe('123456');
  });
});

describe('CloudflareAnalytics', () => {
  it('sums the daily datasets', async () => {
    const f = new FetchMock(() =>
      Response.json({
        data: {
          viewer: {
            accounts: [
              {
                workers: [{sum: {requests: 100}}, {sum: {requests: 50}}],
                d1: [{sum: {rowsWritten: 7}}],
                ai: [],
                queues: [{sum: {billableOperations: 3}}],
              },
            ],
          },
        },
      }),
    );
    const a = new CloudflareAnalytics('acc', 'tok', f.fetch);
    expect(await a.dailyUsage('2026-09-24')).toEqual({
      workers: 150,
      d1Writes: 7,
      neurons: 0,
      queues: 3,
    });
    expect(f.calls[0].headers['authorization']).toBe('Bearer tok');
    expect(JSON.parse(f.calls[0].body).variables).toEqual({
      account: 'acc',
      day: '2026-09-24',
    });
  });
});

describe('SimpleWebAuthn', () => {
  it('requires user verification and rejects malformed responses', async () => {
    const w = new SimpleWebAuthn({
      rpId: 'app.test',
      rpName: 'OntoDecide CE',
      origin: 'https://app.test',
    });
    const reg = await w.registrationOptions({
      userId: 'U1',
      userName: 'root@x.test',
      exclude: [{id: 'AAAA', transports: []}],
    });
    expect(reg.challenge).toBe(reg.options['challenge']);
    expect(reg.options['authenticatorSelection']).toMatchObject({
      userVerification: 'required',
    });
    expect(reg.options['rp']).toMatchObject({id: 'app.test'});
    const auth = await w.authenticationOptions({
      allow: [{id: 'AAAA', transports: ['internal']}],
    });
    expect(auth.options['userVerification']).toBe('required');
    expect(
      await w.verifyRegistration({id: 'x', response: {}}, reg.challenge),
    ).toBeNull();
    expect(
      await w.verifyAuthentication({id: 'x', response: {}}, auth.challenge, {
        credentialId: 'x',
        userId: 'U1',
        publicKey: 'AAAA',
        signCount: 0,
        transports: [],
        label: null,
        createdAt: 0,
        lastUsedAt: null,
      }),
    ).toBeNull();
  });
});
