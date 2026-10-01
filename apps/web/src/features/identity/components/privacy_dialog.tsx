/**
 * @fileoverview The privacy notice in a dialog (sign-up consent and the
 * login page link). Text lives in the `auth` namespace (`privacy.*`) so it
 * follows the UI language; `public/privacy.html` carries the same text for
 * links from e-mails and the static /ended page.
 */

import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';

/** One section of the notice (`privacy.sections.sN`, items `iN`). */
interface PrivacySection {
  title: string;
  items: Record<string, string>;
}

/** Props of {@link PrivacyDialog}. */
export interface PrivacyDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Shows "I have read and accept" (sign-up); called before closing. */
  onAccept?(): void;
}

/** Privacy notice dialog. */
export function PrivacyDialog({
  open,
  onOpenChange,
  onAccept,
}: PrivacyDialogProps) {
  const {t} = useTranslation('auth');
  const raw: unknown = t('privacy.sections', {returnObjects: true});
  const sections =
    raw && typeof raw === 'object'
      ? Object.values(raw as Record<string, PrivacySection>)
      : [];
  let footer: ReactNode;
  if (onAccept) {
    footer = (
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t('common:actions.close')}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onAccept();
            onOpenChange(false);
          }}
        >
          {t('privacy.agree')}
        </Button>
      </>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        title={t('privacy.title')}
        description={t('privacy.effective')}
        footer={footer}
      >
        <div className="flex flex-col gap-5 text-sm leading-relaxed">
          <p className="text-muted">{t('privacy.intro')}</p>
          {sections.map(s => (
            <section key={s.title}>
              <h3 className="mb-1.5 font-semibold text-text">{s.title}</h3>
              <ul className="list-disc space-y-1 pl-5 text-muted marker:text-dim">
                {Object.values(s.items).map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
