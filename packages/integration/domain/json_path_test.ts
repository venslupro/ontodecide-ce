/**
 * @fileoverview Tests for the JSONPath subset.
 */

import {describe, expect, it} from 'vitest';
import {
  extractItems,
  parseJsonPath,
  queryJsonPath,
  selectJsonPath,
} from './json_path';

const doc = {
  data: {items: [{id: 1}, {id: 2}], next: 'c2'},
  pages: [{rows: [1, 2]}, {rows: [3]}],
};

describe('json path', () => {
  it('supports $, dotted keys, indexes and wildcards', () => {
    expect(selectJsonPath(doc, '$')).toBe(doc);
    expect(selectJsonPath(doc, '$.data.next')).toBe('c2');
    expect(selectJsonPath(doc, '$.data.items[0]')).toEqual({id: 1});
    expect(queryJsonPath(doc, '$.data.items[*]')).toEqual([{id: 1}, {id: 2}]);
    expect(queryJsonPath(doc, '$.pages[*].rows[*]')).toEqual([1, 2, 3]);
    expect(selectJsonPath(doc, "$['data']['next']")).toBe('c2');
    expect(selectJsonPath(doc, '$.missing.x')).toBeUndefined();
  });

  it('extracts record arrays', () => {
    expect(extractItems(doc, '$.data.items')).toHaveLength(2);
    expect(extractItems(doc, '$.data.items[*]')).toHaveLength(2);
    expect(extractItems({a: {id: 1}}, '$.a')).toEqual([{id: 1}]);
    expect(extractItems([{id: 1}])).toEqual([{id: 1}]);
    expect(extractItems(doc, '$.nothing')).toEqual([]);
  });

  it('rejects unsupported syntax', () => {
    expect(() => parseJsonPath('data.items')).toThrow(/start with \$/);
    expect(() => parseJsonPath('$..items')).toThrow(/Bad JSONPath/);
    expect(() => parseJsonPath('$.a[?(@.x)]')).toThrow(/Bad JSONPath/);
  });
});
