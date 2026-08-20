/**
 * Minimal S3-compatible client for Backblaze B2.
 *
 * B2 implements the S3 wire protocol, so we use standard AWS Signature
 * V4 signing over HTTPS. This client is intentionally lightweight —
 * it mirrors the subset of the Cloudflare R2Bucket interface that the
 * Ingestion and Cleanup Workers actually use (put / get / delete / list),
 * so the migration from R2 → B2 required minimal call-site changes.
 *
 * All cryptographic operations use the Web Crypto API (SubtleCrypto),
 * which is available in Cloudflare Workers and modern Node.js.
 */
import {nowIso} from '../utils/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface B2ObjectInfo {
  key: string;
  size: number;
  lastModified: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface B2ListResult {
  objects: B2ObjectInfo[];
  truncated: boolean;
  cursor?: string;
}

export interface B2GetResult {
  arrayBuffer(): Promise<ArrayBuffer>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

export interface B2PutOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customMetadata?: Record<string, any>;
  contentType?: string;
}

export interface B2ClientConfig {
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
}

// ---------------------------------------------------------------------------
// B2Client — the interface every Worker depends on.
// ---------------------------------------------------------------------------

export interface B2Client {
  put(key: string, body: ArrayBuffer | string, options?: B2PutOptions): Promise<void>;
  get(key: string): Promise<B2GetResult | null>;
  delete(key: string): Promise<void>;
  list(options?: {prefix?: string; cursor?: string; limit?: number}): Promise<B2ListResult>;
}

/**
 * Create a B2Client backed by the S3-compatible API.
 *
 * Usage in a Worker:
 *   const client = createB2Client({
 *     accessKey: env.B2_KEY_ID,
 *     secretKey: env.B2_KEY,
 *     region:   env.B2_REGION,
 *     bucket:   env.B2_INGESTION_BUCKET,
 *   });
 */
export function createB2Client(config: B2ClientConfig): B2Client {
  const endpoint = `https://s3.${config.region}.backblazeb2.com`;
  return new S3B2Client(endpoint, config);
}

// ---------------------------------------------------------------------------
// S3B2Client — internal implementation.
// ---------------------------------------------------------------------------

class S3B2Client implements B2Client {
  private readonly service = 's3';

  constructor(
    private readonly endpoint: string,
    private readonly config: B2ClientConfig,
  ) {}

  async put(
      key: string,
      body: ArrayBuffer | string,
      options?: B2PutOptions,
  ): Promise<void> {
    const bodyBytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
    const url = `${this.endpoint}/${this.config.bucket}/${key}`;
    const headers = await this.signRequest('PUT', url, bodyBytes, {
      'Content-Type': options?.contentType ?? 'application/octet-stream',
      ...this.metadataHeaders(options?.customMetadata),
    });
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: bodyBytes,
    });
    if (!response.ok) {
      throw new Error(`B2 PUT ${key} failed: ${response.status} ${await response.text()}`);
    }
  }

  async get(key: string): Promise<B2GetResult | null> {
    const url = `${this.endpoint}/${this.config.bucket}/${key}`;
    const headers = await this.signRequest('GET', url, null);
    const response = await fetch(url, {method: 'GET', headers});
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`B2 GET ${key} failed: ${response.status} ${await response.text()}`);
    }
    const metadata = this.parseMetadataHeaders(response.headers);
    return {
      arrayBuffer: () => response.arrayBuffer(),
      metadata,
    };
  }

  async delete(key: string): Promise<void> {
    const url = `${this.endpoint}/${this.config.bucket}/${key}`;
    const headers = await this.signRequest('DELETE', url, null);
    const response = await fetch(url, {method: 'DELETE', headers});
    // 204 = deleted; 404 = already gone (idempotent OK)
    if (!response.ok && response.status !== 404) {
      throw new Error(`B2 DELETE ${key} failed: ${response.status} ${await response.text()}`);
    }
  }

  async list(options?: {prefix?: string; cursor?: string; limit?: number}): Promise<B2ListResult> {
    const maxKeys = options?.limit ?? 1000;
    const query: Record<string, string> = {
      'max-keys': String(maxKeys),
    };
    if (options?.prefix) query['prefix'] = options.prefix;
    if (options?.cursor) query['continuation-token'] = options.cursor;
    const url = new URL(`${this.endpoint}/${this.config.bucket}`);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
    const urlStr = url.toString();
    const headers = await this.signRequest('GET', urlStr, null);
    const response = await fetch(urlStr, {method: 'GET', headers});
    if (!response.ok) {
      throw new Error(`B2 LIST failed: ${response.status} ${await response.text()}`);
    }
    return this.parseListXml(await response.text());
  }

  // ------------------------------------------------------------------
  // AWS Signature V4 implementation (minimal, S3-flavoured).
  // ------------------------------------------------------------------

  private async signRequest(
      method: string,
      url: string,
      body: Uint8Array | null,
      extraHeaders?: Record<string, string>,
  ): Promise<Headers> {
    const parsed = new URL(url);
    const now = new Date();
    const dateStamp = this.dateStamp(now);
    const amzDate = this.amzDate(now);
    const payloadHash = body ? await this.sha256Hex(body) : 'UNSIGNED-PAYLOAD';
    // S3 allows unsigned payloads for streaming PUT, but we hash for simplicity.
    const bodyForHash = body ?? new Uint8Array(0);
    const actualPayloadHash = body ? await this.sha256Hex(bodyForHash) : 'UNSIGNED-PAYLOAD';

    const host = parsed.hostname;
    const headers: Record<string, string> = {
      'Host': host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': actualPayloadHash,
      ...extraHeaders,
    };

    // Build canonical request
    const canonicalUri = this.encodePath(parsed.pathname);
    const canonicalQuery = this.encodeQuery(parsed.searchParams);
    const signedHeaderKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
    const canonicalHeaders = signedHeaderKeys
        .map((k) => `${k}:${headers[this.toOriginalKey(k)]!.trim()}\n`).join('');
    const signedHeaders = signedHeaderKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    // Build string-to-sign
    const scope = `${dateStamp}/${this.config.region}/${this.service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      await this.sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join('\n');

    // Derive signing key
    const signingKey = await this.deriveSigningKey(dateStamp);
    const signature = await this.hmacSha256(signingKey, stringToSign);

    const authHeader =
      `AWS4-HMAC-SHA256 ` +
      `Credential=${this.config.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    headers['Authorization'] = authHeader;
    const result = new Headers();
    for (const [k, v] of Object.entries(headers)) {
      result.set(k, v);
    }
    return result;
  }

  private async deriveSigningKey(dateStamp: string): Promise<ArrayBuffer> {
    const kSecret = new TextEncoder().encode(`AWS4${this.config.secretKey}`);
    const kDate = await this.hmac(kSecret, dateStamp);
    const kRegion = await this.hmac(kDate, this.config.region);
    const kService = await this.hmac(kRegion, this.service);
    return this.hmac(kService, 'aws4_request');
  }

  // ------------------------------------------------------------------
  // Crypto helpers (Web Crypto API)
  // ------------------------------------------------------------------

  private async sha256Hex(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return this.bufferToHex(hashBuffer);
  }

  private async hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
    const keyData: ArrayBuffer = key instanceof Uint8Array ?
      key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer :
      key;
    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'],
    );
    return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  }

  private async hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<string> {
    const sigBuffer = await this.hmac(key, message);
    return this.bufferToHex(sigBuffer);
  }

  private bufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ------------------------------------------------------------------
  // URL/path encoding helpers
  // ------------------------------------------------------------------

  private encodePath(path: string): string {
    // S3 canonical URI: for the path-style endpoint, each path segment
    // (except the leading /) is URI-encoded.
    return path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  }

  private encodeQuery(searchParams: URLSearchParams): string {
    // Canonical query string: sorted by key, URI-encoded.
    const pairs: Array<[string, string]> = [];
    searchParams.forEach((value, key) => {
      pairs.push([encodeURIComponent(key), encodeURIComponent(value)]);
    });
    pairs.sort(([a], [b]) => a.localeCompare(b));
    return pairs.map(([k, v]) => `${k}=${v}`).join('&');
  }

  // ------------------------------------------------------------------
  // Metadata header conventions
  // ------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private metadataHeaders(meta?: Record<string, any>): Record<string, string> {
    if (!meta) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta)) {
      // S3 object metadata is passed via x-amz-meta-* headers.
      result[`x-amz-meta-${k.toLowerCase()}`] = String(v);
    }
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseMetadataHeaders(headers: Headers): Record<string, any> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith('x-amz-meta-')) {
        result[key.toLowerCase().replace('x-amz-meta-', '')] = value;
      }
    });
    return result;
  }

  // ------------------------------------------------------------------
  // S3 ListObjectsV2 XML response parser (minimal)
  // ------------------------------------------------------------------

  private async parseListXml(xml: string): Promise<B2ListResult> {
    // Minimal regex-based parser — avoids pulling in an XML dependency.
    // S3 ListObjectsV2 returns <Contents><Key>…</Key>...</Contents> blocks.
    const objects: B2ObjectInfo[] = [];
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
    const keyRegex = /<Key>(.*?)<\/Key>/;
    const sizeRegex = /<Size>(.*?)<\/Size>/;
    const lastModRegex = /<LastModified>(.*?)<\/LastModified>/;
    let match: RegExpExecArray | null;
    while ((match = contentsRegex.exec(xml)) !== null) {
      const block = match[1];
      const keyMatch = keyRegex.exec(block);
      const sizeMatch = sizeRegex.exec(block);
      const lmMatch = lastModRegex.exec(block);
      if (keyMatch) {
        objects.push({
          key: keyMatch[1],
          size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
          lastModified: lmMatch ? lmMatch[1] : nowIso(),
        });
      }
    }
    const truncated = xml.includes('<IsTruncated>true</IsTruncated>');
    const cursorMatch = /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(xml);
    return {
      objects,
      truncated,
      cursor: cursorMatch ? cursorMatch[1] : undefined,
    };
  }

  // ------------------------------------------------------------------
  // Date formatting helpers
  // ------------------------------------------------------------------

  private dateStamp(d: Date): string {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private amzDate(d: Date): string {
    return d.toISOString().slice(0, 19).replace(/[:-]/g, '') + 'Z';
  }

  private toOriginalKey(lowerKey: string): string {
    // Find the original-cased header key.
    // Since we only add a handful of known headers, use a simple lookup.
    const map: Record<string, string> = {
      'host': 'Host',
      'x-amz-date': 'x-amz-date',
      'x-amz-content-sha256': 'x-amz-content-sha256',
      'content-type': 'Content-Type',
      'authorization': 'Authorization',
    };
    if (map[lowerKey]) return map[lowerKey];
    // For x-amz-meta-* headers, they were added lower-case already.
    return lowerKey;
  }
}

// ---------------------------------------------------------------------------
// Factory for convenience: create a B2 client from Worker env bindings.
// ---------------------------------------------------------------------------

export function createIngestionB2Client(env: {
  B2_KEY_ID: string;
  B2_KEY: string;
  B2_REGION: string;
  B2_INGESTION_BUCKET: string;
}): B2Client {
  return createB2Client({
    accessKey: env.B2_KEY_ID,
    secretKey: env.B2_KEY,
    region: env.B2_REGION,
    bucket: env.B2_INGESTION_BUCKET,
  });
}

export function createArchiveB2Client(env: {
  B2_KEY_ID: string;
  B2_KEY: string;
  B2_REGION: string;
  B2_ARCHIVE_BUCKET: string;
}): B2Client {
  return createB2Client({
    accessKey: env.B2_KEY_ID,
    secretKey: env.B2_KEY,
    region: env.B2_REGION,
    bucket: env.B2_ARCHIVE_BUCKET,
  });
}
