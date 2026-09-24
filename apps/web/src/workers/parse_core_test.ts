/**
 * @fileoverview Parser core: CSV fields / rows of the sample supplier file,
 * 500-row batching, limits (size, rows), JSON and format detection.
 */

import {describe, expect, it} from 'vitest';
import {
  detectFormat,
  jsonRecords,
  parseFile,
  type ParseMessage,
} from './parse_core';

const SUPPLIERS_CSV = `supplierId,name,country,riskScore,capacity,onTimeRate,status,contactEmail,materials,share
S-001,Shenzhen Precision Parts,CN,35,1200,0.96,active,ops@szpp.example,M-100;M-101,0.7
S-002,Hanoi Circuit Works,VN,58,800,0.91,active,sales@hcw.example,M-101;M-102,0.3
S-003,Penang Semicon,MY,22,1500,0.98,active,contact@penang.example,M-102,0.7
S-004,Osaka Battery Co,JP,41,600,0.94,active,info@osakabat.example,M-103,1
S-005,Bangkok Metal Forming,TH,18,900,0.97,active,hello@bmf.example,M-100,0.3
`;

async function run(
  name: string,
  data: string,
  limits?: {rowsMax?: number; bytesMax?: number},
) {
  const out: ParseMessage[] = [];
  await parseFile(
    {name, size: new TextEncoder().encode(data).length, data, limits},
    m => out.push(m),
    () => 0,
  );
  return out;
}

function bigCsv(rows: number): string {
  const lines = ['id,value'];
  for (let i = 0; i < rows; i++) lines.push(`K-${i},${i}`);
  return lines.join('\n');
}

describe('parseFile (CSV)', () => {
  it('parses the sample supplier CSV with header fields', async () => {
    const out = await run('suppliers.csv', SUPPLIERS_CSV);
    const meta = out.find(m => m.type === 'meta');
    expect(meta).toMatchObject({
      type: 'meta',
      fields: [
        'supplierId',
        'name',
        'country',
        'riskScore',
        'capacity',
        'onTimeRate',
        'status',
        'contactEmail',
        'materials',
        'share',
      ],
    });
    if (meta?.type !== 'meta') throw new Error('no meta');
    expect(meta.sampleRows).toHaveLength(5);
    expect(meta.sampleRows[1]).toMatchObject({
      supplierId: 'S-002',
      name: 'Hanoi Circuit Works',
      riskScore: '58',
      materials: 'M-101;M-102',
    });
    const batches = out.filter(m => m.type === 'batch');
    expect(batches).toHaveLength(1);
    expect(out.at(-1)).toEqual({type: 'done', rows: 5, ms: 0});
  });

  it('strips a BOM and skips blank lines', async () => {
    const out = await run('x.csv', '﻿a,b\n1,2\n\n   \n3,4\n');
    expect(out.find(m => m.type === 'meta')).toMatchObject({
      fields: ['a', 'b'],
    });
    expect(out.at(-1)).toMatchObject({type: 'done', rows: 2});
  });

  it('emits batches of 500 rows with contiguous seq', async () => {
    const out = await run('big.csv', bigCsv(1234));
    const batches = out.filter(
      (m): m is Extract<ParseMessage, {type: 'batch'}> => m.type === 'batch',
    );
    expect(batches.map(b => b.seq)).toEqual([0, 1, 2]);
    expect(batches.map(b => b.rows.length)).toEqual([500, 500, 234]);
    expect(batches[2].rows.at(-1)).toEqual({id: 'K-1233', value: '1233'});
    expect(out[0].type).toBe('meta');
    expect(out.at(-1)).toMatchObject({type: 'done', rows: 1234});
  });

  it('rejects files with more than 10,000 rows', async () => {
    const out = await run('huge.csv', bigCsv(10_001));
    expect(out.at(-1)).toMatchObject({type: 'error', code: 'TOO_MANY_ROWS'});
    expect(out.some(m => m.type === 'done')).toBe(false);
  });

  it('accepts exactly 10,000 rows', async () => {
    const out = await run('edge.csv', bigCsv(10_000));
    expect(out.at(-1)).toMatchObject({type: 'done', rows: 10_000});
    expect(out.filter(m => m.type === 'batch')).toHaveLength(20);
  });

  it('rejects files over 20 MB before parsing', async () => {
    const out: ParseMessage[] = [];
    await parseFile(
      {name: 'a.csv', size: 20 * 1024 * 1024 + 1, data: 'a\n1'},
      m => out.push(m),
    );
    expect(out).toEqual([
      {
        type: 'error',
        code: 'FILE_TOO_LARGE',
        detail: String(20 * 1024 * 1024 + 1),
      },
    ]);
  });

  it('honours custom row limits', async () => {
    const out = await run('a.csv', bigCsv(20), {rowsMax: 10});
    expect(out.at(-1)).toMatchObject({type: 'error', code: 'TOO_MANY_ROWS'});
  });

  it('reports an empty file', async () => {
    const out = await run('a.csv', 'a,b\n');
    expect(out.at(-1)).toMatchObject({type: 'error', code: 'EMPTY_FILE'});
  });
});

describe('parseFile (JSON) and helpers', () => {
  it('parses an array of objects', async () => {
    const out = await run(
      'a.json',
      JSON.stringify([
        {id: 'A', n: 1},
        {id: 'B', extra: true},
      ]),
    );
    expect(out.find(m => m.type === 'meta')).toMatchObject({
      fields: ['id', 'n', 'extra'],
    });
    expect(out.at(-1)).toMatchObject({type: 'done', rows: 2});
  });

  it('rejects invalid JSON', async () => {
    expect((await run('a.json', '{nope')).at(-1)).toMatchObject({
      type: 'error',
      code: 'INVALID_JSON',
    });
    expect((await run('a.json', '[1,2]')).at(-1)).toMatchObject({
      type: 'error',
      code: 'INVALID_JSON',
    });
  });

  it('extracts records from wrappers', () => {
    expect(jsonRecords({items: [{a: 1}]})).toEqual([{a: 1}]);
    expect(jsonRecords({data: [{a: 1}]})).toEqual([{a: 1}]);
    expect(jsonRecords({x: 1})).toBeNull();
  });

  it('detects formats', () => {
    expect(detectFormat('a.CSV')).toBe('csv');
    expect(detectFormat('a.xlsx')).toBe('xlsx');
    expect(detectFormat('a.json')).toBe('json');
    expect(detectFormat('a.pdf')).toBeNull();
  });

  it('rejects unsupported formats', async () => {
    expect((await run('a.pdf', 'x')).at(-1)).toMatchObject({
      type: 'error',
      code: 'UNSUPPORTED_FORMAT',
    });
  });
});
