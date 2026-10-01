/**
 * @fileoverview Page-level display controls (theme + 中文 | EN) for the
 * pages without the app shell: sign-up, login, admin setup and the public
 * info pages. They sit in the page header, never inside a form card.
 */

import {ThemeSwitch} from '../../../shared/ui/theme_switch';
import {LangSwitch} from './lang_switch';

/** Theme and language switches, right-aligned in a page header. */
export function PageControls() {
  return (
    <div className="flex items-center gap-2">
      <ThemeSwitch />
      <LangSwitch />
    </div>
  );
}
