/**
 * @fileoverview Browser file parsing: CSV (BOM, empty rows, duplicate
 * headers), JSON shapes, XLSX cell values (built with XLSX.utils), size and
 * format pre-checks, the row safety bound and the worker request handler.
 */

import {describe, expect, it} from 'vitest';
import * as XLSX from 'xlsx';
import {
  detectFormat,
  handleParseRequest,
  jsonRecords,
  parseCsvText,
  parseFileData,
  parseJsonText,
  parseXlsxBuffer,
  ParseError,
  precheckFile,
  SAMPLE_ROWS,
} from './parse_core';

function xlsxBytes(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return new Uint8Array(
    XLSX.write(wb, {type: 'array', bookType: 'xlsx'}) as ArrayBuffer,
  );
}

async function parseError(p: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    return e as ParseError;
  }
  throw new Error('expected a ParseError');
}

describe('detectFormat / precheckFile', () => {
  it('detects formats by extension and MIME type', () => {
    expect(detectFormat('a.CSV')).toBe('csv');
    expect(detectFormat('a.xlsx')).toBe('xlsx');
    expect(detectFormat('a.json')).toBe('json');
    expect(detectFormat('blob', 'application/json')).toBe('json');
    expect(detectFormat('a.xls')).toBeNull();
    expect(detectFormat('a.txt')).toBeNull();
  });

  it('checks size (≤ 5 MB) and format before reading', () => {
    expect(precheckFile({name: 'a.csv', size: 5 * 1024 * 1024})).toBeNull();
    expect(precheckFile({name: 'a.csv', size: 5 * 1024 * 1024 + 1})?.code).toBe(
      'FILE_TOO_LARGE',
    );
    expect(precheckFile({name: 'a.pdf', size: 10})?.code).toBe(
      'UNSUPPORTED_FORMAT',
    );
    expect(precheckFile({name: 'a.csv', size: 0})?.code).toBe('EMPTY_FILE');
  });

  it('never reads an oversized file', async () => {
    const data = {
      text: () => {
        throw new Error('read');
      },
    } as unknown as Blob;
    const err = await parseError(
      parseFileData({name: 'a.csv', size: 6 * 1024 * 1024, data}),
    );
    expect(err.code).toBe('FILE_TOO_LARGE');
  });
});

describe('parseCsvText', () => {
  it('strips the BOM, trims headers and skips empty rows', () => {
    const t = parseCsvText(
      '\uFEFFvendor_code, vendor_name ,risk\r\nS-017,苏州精密,82\r\n,,\r\n\r\nS-022,"Ningbo, Ltd",21\r\n',
    );
    expect(t.format).toBe('csv');
    expect(t.fields).toEqual(['vendor_code', 'vendor_name', 'risk']);
    expect(t.rows).toEqual([
      {vendor_code: 'S-017', vendor_name: '苏州精密', risk: '82'},
      {vendor_code: 'S-022', vendor_name: 'Ningbo, Ltd', risk: '21'},
    ]);
    expect(t.truncated).toBe(false);
  });

  it('renames duplicate headers and drops unnamed columns', () => {
    const t = parseCsvText('a,a,,b\n1,2,3,4\n');
    expect(t.fields).toEqual(['a', 'a_2', 'b']);
    expect(t.rows[0]).toEqual({a: '1', a_2: '2', b: '4'});
  });

  it('keeps 20 sample rows and caps rows at the safety bound', () => {
    const body = Array.from({length: 30}, (_, i) => `k${i},${i}`).join('\n');
    const t = parseCsvText(`k,v\n${body}`, {maxRows: 25});
    expect(t.sampleRows).toHaveLength(SAMPLE_ROWS);
    expect(t.rows).toHaveLength(25);
    expect(t.truncated).toBe(true);
  });

  it('fails on a header-only file', () => {
    expect(() => parseCsvText('a,b\n')).toThrow(ParseError);
  });
});

describe('JSON', () => {
  it('accepts arrays and {items|data|records|rows} wrappers', () => {
    const rows = [{a: 1}, {b: 'x'}];
    expect(jsonRecords(rows)).toEqual(rows);
    for (const k of ['items', 'data', 'records', 'rows']) {
      expect(jsonRecords({[k]: rows})).toEqual(rows);
    }
    expect(jsonRecords({foo: rows})).toBeNull();
    expect(jsonRecords([1, 2])).toBeNull();
    expect(jsonRecords([[1]])).toBeNull();
  });

  it('parses objects with the union of their keys', () => {
    const t = parseJsonText('{"data":[{"a":1},{"a":2,"b":true},{}]}');
    expect(t.fields).toEqual(['a', 'b']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]).toEqual({a: 2, b: true});
  });

  it('reports invalid JSON', async () => {
    expect((await parseError(() => parseJsonText('{'))).code).toBe(
      'INVALID_JSON',
    );
    expect((await parseError(() => parseJsonText('{"x":1}'))).code).toBe(
      'INVALID_JSON',
    );
  });
});

describe('parseXlsxBuffer', () => {
  it('reads the first sheet as cell values', async () => {
    const bytes = xlsxBytes([
      ['supplierId', 'name', 'risk'],
      ['S-1', 'Alpha', 82],
      [null, null, null],
      ['S-2', 'Beta', 21.5],
    ]);
    const t = await parseXlsxBuffer(bytes);
    expect(t.format).toBe('xlsx');
    expect(t.fields).toEqual(['supplierId', 'name', 'risk']);
    expect(t.rows).toEqual([
      {supplierId: 'S-1', name: 'Alpha', risk: 82},
      {supplierId: 'S-2', name: 'Beta', risk: 21.5},
    ]);
  });

  it('does not evaluate formulas (only the stored value is read)', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['a', 'b'],
      [1, 2],
    ]);
    ws.B2 = {t: 'n', f: 'A2*100', v: 7};
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = XLSX.write(wb, {type: 'array', bookType: 'xlsx'});
    const t = await parseXlsxBuffer(buf as ArrayBuffer);
    expect(t.rows[0]).toEqual({a: 1, b: 7});
  });

  it('parses through parseFileData with a Blob', async () => {
    const bytes = xlsxBytes([['k'], ['v']]);
    const blob = new Blob([bytes as BlobPart]);
    const t = await parseFileData({
      name: 'x.xlsx',
      size: blob.size,
      data: blob,
    });
    expect(t.rows).toEqual([{k: 'v'}]);
  });
});

describe('handleParseRequest', () => {
  it('returns the table or an error code', async () => {
    const ok = new Blob(['a,b\n1,2\n']);
    expect(
      await handleParseRequest({
        name: 'a.csv',
        size: ok.size,
        type: 'text/csv',
        data: ok,
      }),
    ).toMatchObject({ok: true, table: {fields: ['a', 'b']}});
    expect(
      await handleParseRequest({
        name: 'a.csv',
        size: 100,
        type: '',
        data: ok,
        limits: {maxBytes: 10},
      }),
    ).toEqual({ok: false, code: 'FILE_TOO_LARGE', detail: '10'});
  });
});
