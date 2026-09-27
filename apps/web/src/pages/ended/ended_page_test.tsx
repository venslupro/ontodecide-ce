/**
 * @fileoverview /ended: static, no API calls, `?lang=` respected.
 */

import {screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {i18n} from '../../shared/lib/i18n';
import {platformDb} from '../../test/handlers/platform';
import {renderApp} from '../../test/render';

describe('EndedPage', () => {
  it('explains where the data went without calling any API', async () => {
    renderApp('/ended', {as: 'anonymous'});
    expect(await screen.findByText('你的数据已打包')).toBeInTheDocument();
    expect(screen.getByText('下载链接已发到邮箱')).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: '重新注册新的试用'}),
    ).toHaveAttribute('href', '/signup');
    expect(
      screen.getByText(
        '没收到邮件？请检查垃圾邮件。账户已删除，系统无法再次发送链接。',
      ),
    ).toBeInTheDocument();
    expect(platformDb.requests).toEqual([]);
  });

  it('renders in English', async () => {
    await i18n.changeLanguage('en-US');
    renderApp('/ended?lang=en', {as: 'anonymous'});
    expect(await screen.findByText('Your data is packed')).toBeInTheDocument();
    expect(platformDb.requests).toEqual([]);
  });
});
