/**
 * @fileoverview Framework-free /ended page (ended.html): same content as the
 * React route, language from ?lang= / local preference / navigator, the
 * 中文 | EN switch, and no network access.
 */

import {afterEach, describe, expect, it, vi} from 'vitest';
import {endedHtml, renderEnded, resolveStaticLang} from './ended_static';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('resolveStaticLang', () => {
  it('follows ?lang= > local preference > navigator > zh-CN', () => {
    expect(resolveStaticLang('?lang=en', 'zh-CN', ['zh'])).toBe('en-US');
    expect(resolveStaticLang('', 'en-US', ['zh'])).toBe('en-US');
    expect(resolveStaticLang('', undefined, ['fr', 'en-GB'])).toBe('en-US');
    expect(resolveStaticLang('', undefined, ['fr'])).toBe('zh-CN');
  });
});

describe('static /ended', () => {
  it('renders the explanation and links without calling any API', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const root = document.createElement('div');
    document.body.append(root);
    renderEnded(root, 'zh-CN');
    expect(root.textContent).toContain('你的数据已打包');
    expect(root.textContent).toContain('下载链接已发到邮箱');
    expect(root.textContent).toContain(
      '没收到邮件？请检查垃圾邮件。账户已删除，系统无法再次发送链接。',
    );
    const signup = [...root.querySelectorAll('a')].find(
      a => a.textContent === '重新注册新的试用',
    );
    expect(signup?.getAttribute('href')).toBe('/signup');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('switches to English in place', () => {
    const root = document.createElement('div');
    document.body.append(root);
    renderEnded(root, 'zh-CN');
    root.querySelector<HTMLButtonElement>('[data-lang="en-US"]')!.click();
    expect(root.textContent).toContain('Your data is packed');
    expect(
      root.querySelector('[data-lang="en-US"]')!.getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('escapes text', () => {
    expect(endedHtml('en-US')).not.toMatch(/<script/i);
  });
});
