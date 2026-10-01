/**
 * @fileoverview Page-level display controls (theme + 中文 | EN) for the
 * pages without the app shell: sign-up, login, admin setup and the public
 * info pages. They sit in the page header, never inside a form card.
 */

import {ThemeSwitch} from '../../../shared/ui/theme_switch';
import {LangSwitch} from './lang_switch';

/** Theme and language switches, right-aligned in a page header. */
export function PageControls() {
  // "auto": compact on phones so brand + both switches fit a 320px header.
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <ThemeSwitch size="auto" />
      <LangSwitch size="auto" />
    </div>
  );
}
