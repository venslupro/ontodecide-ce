/**
 * @fileoverview In-memory BlobStore (versioned like B2) and LinkSigner for
 * tests and the in-process e2e harness. Failures can be injected per
 * operation.
 */

import type {BlobStore, LinkSigner} from '../application';

/** Operations that can be made to fail. */
export type BlobOp = 'put' | 'get' | 'head' | 'delete';

/** Versioned in-memory object store. */
export class InMemoryBlobStore implements BlobStore {
  /** key → versions (oldest first). */
  readonly versions = new Map<string, Uint8Array[]>();
  private readonly failures = new Map<BlobOp, number>();
  /** Makes the next head() report a wrong size. */
  corruptNextHead = false;

  /** Makes the next `times` calls of an operation throw. */
  failNext(op: BlobOp, times = 1): void {
    this.failures.set(op, (this.failures.get(op) ?? 0) + times);
  }

  private check(op: BlobOp): void {
    const n = this.failures.get(op) ?? 0;
    if (n > 0) {
      this.failures.set(op, n - 1);
      throw new Error(`injected ${op} failure`);
    }
  }

  async put(key: string, body: Uint8Array | string): Promise<void> {
    this.check('put');
    const bytes =
      typeof body === 'string' ? new TextEncoder().encode(body) : body.slice();
    const list = this.versions.get(key) ?? [];
    list.push(bytes);
    this.versions.set(key, list);
  }

  async get(key: string): Promise<Uint8Array | null> {
    this.check('get');
    const list = this.versions.get(key);
    return list && list.length > 0 ? list[list.length - 1].slice() : null;
  }

  async head(key: string): Promise<{size: number} | null> {
    this.check('head');
    const list = this.versions.get(key);
    if (!list || list.length === 0) return null;
    const size = list[list.length - 1].byteLength;
    if (this.corruptNextHead) {
      this.corruptNextHead = false;
      return {size: size + 1};
    }
    return {size};
  }

  async deletePrefix(prefix: string): Promise<number> {
    this.check('delete');
    let n = 0;
    for (const [k, v] of [...this.versions]) {
      if (!k.startsWith(prefix)) continue;
      n += v.length;
      this.versions.delete(k);
    }
    return n;
  }

  async deleteAllVersions(key: string): Promise<number> {
    this.check('delete');
    const n = this.versions.get(key)?.length ?? 0;
    this.versions.delete(key);
    return n;
  }

  /** Keys with at least one version. */
  keys(): string[] {
    return [...this.versions.keys()].sort();
  }
}

/** Deterministic fake presigner (`memory://key?ttl=…`). */
export class FakeLinkSigner implements LinkSigner {
  async presignGet(
    key: string,
    ttlSeconds: number,
    disposition: string,
  ): Promise<string> {
    const q = new URLSearchParams({ttl: String(ttlSeconds), disposition});
    return `https://blob.test/${key}?${q.toString()}`;
  }
}
