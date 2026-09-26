/**
 * @fileoverview B2 (S3-compatible) presigned PUT URLs. The SigV4 signer is
 * injected (aws4fetch `AwsClient` in the Worker) so this adapter stays free
 * of runtime-specific imports.
 */

import type {Clock} from '@ontodecide/shared-kernel';
import type {PresignedUpload, UploadPresigner} from '../application';

/** The subset of aws4fetch's AwsClient used for query signing. */
export interface SigV4Signer {
  sign(
    input: string,
    init: {
      method: string;
      aws: {signQuery: true; service: 's3'; region?: string; datetime?: string};
    },
  ): Promise<Request>;
}

/** SigV4 timestamp `YYYYMMDDTHHMMSSZ`. */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/** Derives the region from `s3.<region>.backblazeb2.com`. */
export function regionFromEndpoint(endpoint: string): string | undefined {
  return endpoint.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/)?.[1];
}

/** Path-style presigned PUT: `https://{endpoint}/{bucket}/{key}`. */
export class B2Presigner implements UploadPresigner {
  private readonly endpoint: string;

  constructor(
    private readonly opts: {
      signer: SigV4Signer;
      endpoint: string;
      bucket: string;
      region?: string;
      clock: Clock;
    },
  ) {
    this.endpoint = opts.endpoint
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
  }

  async presignPut(
    key: string,
    _bytes: number,
    expiresSec: number,
  ): Promise<PresignedUpload> {
    const now = this.opts.clock.now();
    const path = key.split('/').map(encodeURIComponent).join('/');
    const url = `https://${this.endpoint}/${encodeURIComponent(this.opts.bucket)}/${path}?X-Amz-Expires=${expiresSec}`;
    const signed = await this.opts.signer.sign(url, {
      method: 'PUT',
      aws: {
        signQuery: true,
        service: 's3',
        region: this.opts.region ?? regionFromEndpoint(this.endpoint),
        datetime: amzDate(now),
      },
    });
    return {
      url: signed.url,
      expiresAt: new Date(now.getTime() + expiresSec * 1000).toISOString(),
    };
  }
}

/** Used when B2 credentials are absent: the UI skips the archive upload. */
export class DisabledPresigner implements UploadPresigner {
  constructor(private readonly clock: Clock) {}

  async presignPut(
    _key: string,
    _bytes: number,
    expiresSec: number,
  ): Promise<PresignedUpload> {
    return {
      url: '',
      expiresAt: new Date(
        this.clock.now().getTime() + expiresSec * 1000,
      ).toISOString(),
    };
  }
}
