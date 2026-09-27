/**
 * @fileoverview /archive-deletions/:token: info, token stripped from the
 * address bar, confirmation + Idempotency-Key, invalid link.
 */

import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {recorded, VALID_DELETION_TOKEN} from '../../test/handlers/platform';
import {renderApp} from '../../test/render';

describe('ArchiveDeletionPage', () => {
  it('shows size and deletion time, strips the token and deletes after confirming', async () => {
    const replace = vi.spyOn(history, 'replaceState');
    const user = userEvent.setup();
    renderApp(`/archive-deletions/${VALID_DELETION_TOKEN}`, {as: 'anonymous'});
    expect(await screen.findByText('412 KB')).toBeInTheDocument();
    expect(
      replace.mock.calls.some(c => c[2] === '/archive-deletions/used'),
    ).toBe(true);
    const submit = screen.getByRole('button', {name: '确认删除'});
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(submit);
    expect(
      await screen.findByText('归档已删除，邮件中的下载链接已失效。'),
    ).toBeInTheDocument();
    const [post] = recorded('POST', '/archive-deletions/');
    expect(post.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(post.headers.authorization).toBeUndefined();
    replace.mockRestore();
  });

  it('shows "link expired" for an unknown token', async () => {
    renderApp('/archive-deletions/tok-unknown-00000000', {as: 'anonymous'});
    expect(
      await screen.findByText('链接已失效或归档已删除'),
    ).toBeInTheDocument();
  });
});
