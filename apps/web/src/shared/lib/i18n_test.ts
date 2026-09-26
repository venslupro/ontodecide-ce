/**
 * @fileoverview Language resolution order and ICU formatting.
 */

import {describe, expect, it} from 'vitest';
import {i18n, normalizeLang, otherLang, resolveLanguage} from './i18n';

describe('resolveLanguage', () => {
  it('prefers ?lang, then account, local, navigator, default zh-CN', () => {
    expect(
      resolveLanguage({search: '?lang=en', account: 'zh-CN', local: 'zh-CN'}),
    ).toBe('en-US');
    expect(
      resolveLanguage({search: '?x=1', account: 'en-US', local: 'zh-CN'}),
    ).toBe('en-US');
    expect(resolveLanguage({local: 'en-US', navigator: ['zh-CN']})).toBe(
      'en-US',
    );
    expect(resolveLanguage({navigator: ['fr-FR', 'en-GB']})).toBe('en-US');
    expect(resolveLanguage({navigator: ['fr-FR']})).toBe('zh-CN');
    expect(resolveLanguage({})).toBe('zh-CN');
  });

  it('normalizes tags', () => {
    expect(normalizeLang('zh-TW')).toBe('zh-CN');
    expect(normalizeLang('EN')).toBe('en-US');
    expect(normalizeLang('de')).toBeNull();
    expect(otherLang('zh-CN')).toBe('en-US');
  });

  it('formats ICU plurals and numbers in both languages', async () => {
    expect(i18n.t('common:topbar.notifications', {count: 3})).toBe(
      '通知中心，3 条未读',
    );
    await i18n.changeLanguage('en-US');
    expect(i18n.t('common:topbar.notifications', {count: 1})).toBe(
      'Notifications, 1 unread',
    );
    expect(i18n.t('common:state.total', {count: 12345})).toBe('12,345 total');
    expect(document.documentElement.lang).toBe('en-US');
    await i18n.changeLanguage('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
