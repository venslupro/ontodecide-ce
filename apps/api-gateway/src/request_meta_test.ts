/**
 * @fileoverview RequestMeta and locale parsing.
 */

import {describe, expect, it} from 'vitest';
import {clientLabel, localeOf, requestMeta} from './request_meta';

describe('clientLabel', () => {
  it('derives browser · OS', () => {
    expect(
      clientLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      ),
    ).toBe('Edge · Windows');
    expect(
      clientLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari · iOS');
    expect(clientLabel('curl/8.0')).toBe('Other');
    expect(clientLabel(null)).toBeUndefined();
  });
});

describe('localeOf', () => {
  it('picks the best supported language by q', () => {
    expect(localeOf('en-US,en;q=0.9')).toBe('en-US');
    expect(localeOf('zh-TW,zh;q=0.9,en;q=0.8')).toBe('zh-CN');
    expect(localeOf('fr;q=1, zh;q=0.4, en;q=0.6')).toBe('en-US');
    expect(localeOf('de')).toBe('zh-CN');
    expect(localeOf(null)).toBe('zh-CN');
  });
});

describe('requestMeta', () => {
  it('reads CF-Connecting-IP', () => {
    expect(requestMeta(new Headers({'cf-connecting-ip': '192.0.2.1'}))).toEqual(
      {
        ip: '192.0.2.1',
      },
    );
    expect(requestMeta(new Headers()).ip).toBe('unknown');
  });
});
