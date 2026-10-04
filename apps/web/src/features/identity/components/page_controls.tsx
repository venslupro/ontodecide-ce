/**
 * @fileoverview Page-level language switch (中文 | EN) for the pages without
 * the app shell: sign-up, login, admin setup and the public info pages. It
 * sits in the page header, never inside a form card.
 */

import {LangSwitch} from './lang_switch';

/** Language switch, right-aligned in a page header. */
export function PageControls() {
  // "auto": compact on phones so brand + the switch fit a 320px header.
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <LangSwitch size="auto" />
    </div>
  );
}
