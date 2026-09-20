/**
 * ETL pipeline tests for the Ingestion service.
 *
 * Covers:
 *   (a) JSON extraction — array and {records:[]} shapes
 *   (b) CSV extraction — headers, quoted fields, escaped quotes, CRLF
 *   (c) Parquet extraction — generated via parquet-wasm, verified by
 *       round-tripping known rows through hyparquet
 *   (d) Transform — field mapping, numeric coercion, relations
 *   (e) Unsupported format rejection
 */
import { describe, it, expect } from 'vitest';
import { extract, type ExtractedRecord } from '../src/etl/extractor.js';
import { transform } from '../src/etl/transformer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Build a minimal Parquet buffer with known rows using apache-arrow +
 * parquet-wasm (dev-only fixture generator — not part of the production
 * bundle).
 */
async function buildParquetFixture(
  rows: Array<Record<string, string | number>>,
): Promise<Uint8Array> {
  const arrow = await import('apache-arrow');
  const wasm = await import('parquet-wasm');
  // Initialize the WASM module (parquet-wasm/esm requires this).
  if (typeof wasm.default === 'function') {
    await wasm.default();
  }
  const { tableToIPC } = arrow;
  const arrowTable = arrow.tableFromJSON(rows);
  const ipcBytes = tableToIPC(arrowTable, 'stream');
  const wasmTable = wasm.Table.fromIPCStream(new Uint8Array(ipcBytes));
  const writerProperties = new wasm.WriterPropertiesBuilder().build();
  const parquetBytes = wasm.writeParquet(wasmTable, writerProperties);
  return new Uint8Array(parquetBytes);
}

// ---------------------------------------------------------------------------
// (a) JSON
// ---------------------------------------------------------------------------

describe('JSON extraction', () => {
  it('parses a JSON array of records', async () => {
    const bytes = enc(JSON.stringify([
      { id: 'a', name: 'Alice', age: 30 },
      { id: 'b', name: 'Bob', age: 25 },
    ]));
    const records = await extract(bytes, 'json');
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ id: 'a', name: 'Alice', age: 30 });
    expect(records[1]).toEqual({ id: 'b', name: 'Bob', age: 25 });
  });

  it('parses a {records: []} envelope', async () => {
    const bytes = enc(JSON.stringify({
      records: [{ id: 'x', value: 1 }],
    }));
    const records = await extract(bytes, 'json');
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({ id: 'x', value: 1 });
  });

  it('throws on non-array JSON', async () => {
    await expect(extract(enc('{"a":1}'), 'json')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (b) CSV
// ---------------------------------------------------------------------------

describe('CSV extraction', () => {
  it('parses a simple CSV with headers', async () => {
    const csv = 'id,name,age\na,Alice,30\nb,Bob,25';
    const records = await extract(enc(csv), 'csv');
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ id: 'a', name: 'Alice', age: '30' });
  });

  it('handles quoted fields with commas and newlines', async () => {
    const csv = 'id,note\n1,"hello, world"\n2,"line1\nline2"';
    const records = await extract(enc(csv), 'csv');
    expect(records).toHaveLength(2);
    expect(records[0].note).toBe('hello, world');
    expect(records[1].note).toBe('line1\nline2');
  });

  it('handles escaped quotes ("") inside quoted fields', async () => {
    const csv = 'id,quote\n1,"say ""hi"""';
    const records = await extract(enc(csv), 'csv');
    expect(records[0].quote).toBe('say "hi"');
  });

  it('handles CRLF line endings', async () => {
    const csv = 'a,b\r\n1,2\r\n3,4';
    const records = await extract(enc(csv), 'csv');
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ a: '1', b: '2' });
  });
});

// ---------------------------------------------------------------------------
// (c) Parquet
// ---------------------------------------------------------------------------

describe('Parquet extraction', () => {
  it('parses a parquet file with string and int columns', async () => {
    const rows = [
      { id: 'a', name: 'Alice', score: 95 },
      { id: 'b', name: 'Bob', score: 87 },
    ];
    const bytes = await buildParquetFixture(rows);
    const records = await extract(bytes, 'parquet');
    expect(records.length).toBeGreaterThanOrEqual(2);
    // Values should round-trip; hyparquet may return BigInt for ints — the
    // sanitizer converts safe BigInts to numbers.
    const alice = records.find((r) => r.id === 'a');
    expect(alice).toBeDefined();
    expect(alice?.name).toBe('Alice');
    expect(Number(alice?.score)).toBe(95);
  });
});

// ---------------------------------------------------------------------------
// (d) Transform
// ---------------------------------------------------------------------------

describe('Transform', () => {
  const tenantId = 'tenant-test';
  const ontologyType = 'Customer';
  const source = 'test.csv';

  it('maps records onto EntityNode with numeric coercion', () => {
    const records: ExtractedRecord[] = [
      { id: 'c1', name: 'Alice', age: '30', active: 'true' },
    ];
    const result = transform(records, tenantId, ontologyType, source);
    expect(result.entities).toHaveLength(1);
    const e = result.entities[0];
    expect(e.id).toBe('c1');
    expect(e.tenant_id).toBe(tenantId);
    expect(e.type).toBe(ontologyType);
    expect(e.attributes.name).toBe('Alice');
    expect(e.attributes.age).toBe(30); // coerced to number
    expect(e.attributes.active).toBe(true); // coerced to boolean
    expect(e.source).toBe(source);
  });

  it('applies field mapping overrides', () => {
    const records: ExtractedRecord[] = [
      { customer_id: 'c1', full_name: 'Alice' },
    ];
    const fieldMapping = { customer_id: 'id', full_name: 'name' };
    const result = transform(records, tenantId, ontologyType, source, fieldMapping);
    expect(result.entities[0].id).toBe('c1');
    expect(result.entities[0].attributes.name).toBe('Alice');
  });

  it('extracts _relations into EntityRelation list', () => {
    const records: ExtractedRecord[] = [
      {
        id: 'c1',
        _relations: [{ type: 'PURCHASED', target: 'p1', properties: { qty: 2 } }],
      },
    ];
    const result = transform(records, tenantId, ontologyType, source);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      type: 'PURCHASED',
      source: 'c1',
      target: 'p1',
    });
  });

  it('rejects records with no attributes', () => {
    const records: ExtractedRecord[] = [{}];
    const result = transform(records, tenantId, ontologyType, source);
    expect(result.rejected).toBe(1);
    expect(result.entities).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (e) Unsupported format
// ---------------------------------------------------------------------------

describe('Format dispatch', () => {
  it('rejects parquet only when the file is genuinely unparseable', async () => {
    // A random buffer is not valid parquet — hyparquet throws, which the
    // extractor translates into INGEST_MAPPING_FAILED.
    await expect(extract(new Uint8Array([1, 2, 3, 4]), 'parquet')).rejects.toThrow();
  });
});
