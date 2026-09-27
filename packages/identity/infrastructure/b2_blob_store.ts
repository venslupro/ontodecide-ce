/**
 * @fileoverview Backblaze B2 archive bucket over its S3-compatible API
 * (aws4fetch SigV4): `https://${B2_ENDPOINT}/${bucket}/${key}` with the
 * write key (put / get / head / list versions / delete), and local presigned
 * GET links with the read-only sign key (no B2 call, no transaction).
 */

import {AwsClient} from 'aws4fetch';
import {AppError} from '@ontodecide/shared-kernel';
import type {BlobStore, LinkSigner} from '../application';

/** B2 S3 endpoint settings. */
export interface B2Endpoint {
  /** Host, e.g. `s3.us-west-004.backblazeb2.com`. */
  endpoint: string;
  bucket: string;
  region: string;
}

/** A B2 application key. */
export interface B2Key {
  keyId: string;
  appKey: string;
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function baseUrl(e: B2Endpoint): string {
  const host = e.endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${host}/${e.bucket}`;
}

/**
 * Creates the S3 client on first use, so a Worker without B2 keys (local
 * development) still starts; only B2 operations fail.
 */
function lazyClient(key: B2Key, e: B2Endpoint): () => AwsClient {
  let aws: AwsClient | undefined;
  return () => {
    if (!key.keyId || !key.appKey) {
      throw new AppError('UNAVAILABLE', 'B2 is not configured');
    }
    return (aws ??= client(key, e));
  };
}

function client(key: B2Key, e: B2Endpoint): AwsClient {
  return new AwsClient({
    accessKeyId: key.keyId,
    secretAccessKey: key.appKey,
    service: 's3',
    region: e.region,
  });
}

function xmlValues(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]);
  return out;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** B2 bucket accessed with the write key. */
export class B2BlobStore implements BlobStore {
  private readonly aws: () => AwsClient;
  private readonly base: string;

  constructor(
    key: B2Key,
    endpoint: B2Endpoint,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.aws = lazyClient(key, endpoint);
    this.base = baseUrl(endpoint);
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const req = await this.aws().sign(url, init);
    return this.fetchFn(req);
  }

  private fail(op: string, res: Response): never {
    throw new AppError('UNAVAILABLE', `B2 ${op} failed (${res.status})`);
  }

  async put(
    key: string,
    body: Uint8Array | string,
    contentType = 'application/octet-stream',
  ) {
    const res = await this.call(`${this.base}/${encodeKey(key)}`, {
      method: 'PUT',
      body: typeof body === 'string' ? body : (body as Uint8Array<ArrayBuffer>),
      headers: {'content-type': contentType},
    });
    if (!res.ok) this.fail('put', res);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.call(`${this.base}/${encodeKey(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) this.fail('get', res);
    return new Uint8Array(await res.arrayBuffer());
  }

  async head(key: string): Promise<{size: number} | null> {
    const res = await this.call(`${this.base}/${encodeKey(key)}`, {
      method: 'HEAD',
    });
    if (res.status === 404) return null;
    if (!res.ok) this.fail('head', res);
    return {size: Number(res.headers.get('content-length') ?? '0')};
  }

  /** Lists every version (and delete marker) under a prefix. */
  async listVersions(
    prefix: string,
  ): Promise<{key: string; versionId: string}[]> {
    const out: {key: string; versionId: string}[] = [];
    let keyMarker: string | null = null;
    let versionMarker: string | null = null;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({prefix});
      if (keyMarker) q.set('key-marker', keyMarker);
      if (versionMarker) q.set('version-id-marker', versionMarker);
      const res = await this.call(`${this.base}?versions&${q.toString()}`);
      if (!res.ok) this.fail('list', res);
      const xml = await res.text();
      for (const tag of ['Version', 'DeleteMarker']) {
        for (const block of xmlValues(xml, tag)) {
          const key = xmlValues(block, 'Key')[0];
          const versionId = xmlValues(block, 'VersionId')[0];
          if (key && versionId) out.push({key: unescapeXml(key), versionId});
        }
      }
      if (xmlValues(xml, 'IsTruncated')[0] !== 'true') break;
      keyMarker = xmlValues(xml, 'NextKeyMarker')[0] ?? null;
      versionMarker = xmlValues(xml, 'NextVersionIdMarker')[0] ?? null;
      if (!keyMarker) break;
    }
    return out;
  }

  private async deleteVersions(versions: {key: string; versionId: string}[]) {
    for (const v of versions) {
      const res = await this.call(
        `${this.base}/${encodeKey(v.key)}?versionId=${encodeURIComponent(v.versionId)}`,
        {method: 'DELETE'},
      );
      if (!res.ok && res.status !== 404) this.fail('delete', res);
    }
    return versions.length;
  }

  async deletePrefix(prefix: string): Promise<number> {
    return this.deleteVersions(await this.listVersions(prefix));
  }

  async deleteAllVersions(key: string): Promise<number> {
    const versions = (await this.listVersions(key)).filter(v => v.key === key);
    return this.deleteVersions(versions);
  }
}

/** Presigned GET links with the read-only sign key (computed locally). */
export class B2LinkSigner implements LinkSigner {
  private readonly aws: () => AwsClient;
  private readonly base: string;

  constructor(key: B2Key, endpoint: B2Endpoint) {
    this.aws = lazyClient(key, endpoint);
    this.base = baseUrl(endpoint);
  }

  async presignGet(
    key: string,
    ttlSeconds: number,
    disposition: string,
  ): Promise<string> {
    const url = new URL(`${this.base}/${encodeKey(key)}`);
    url.searchParams.set('response-content-disposition', disposition);
    url.searchParams.set(
      'X-Amz-Expires',
      String(Math.min(604_800, Math.max(1, ttlSeconds))),
    );
    const req = await this.aws().sign(url.toString(), {
      method: 'GET',
      aws: {signQuery: true},
    });
    return req.url;
  }
}
