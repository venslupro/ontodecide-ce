/**
 * @fileoverview Shows a temporary password exactly once, with a copy button
 * and a warning that it will not be shown again. The caller clears the
 * secret from its state on close.
 */

import {AlertTriangle, Check, Copy, KeyRound} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';

/** A one-time secret to display. */
export interface OneTimeSecret {
  email: string;
  password: string;
  reason: 'created' | 'reset';
}

/** One-time temporary password dialog. */
export function TemporaryPasswordDialog({
  secret,
  onClose,
}: {
  secret: OneTimeSecret | null;
  onClose(): void;
}) {
  const {t} = useTranslation('admin');
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [secret]);

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={!!secret} onOpenChange={o => !o && onClose()}>
      {secret && (
        <DialogContent
          size="sm"
          title={
            secret.reason === 'created'
              ? t('secret.createdTitle')
              : t('secret.resetTitle')
          }
          description={t('secret.description', {email: secret.email})}
          footer={
            <Button variant="primary" onClick={onClose}>
              {t('secret.done')}
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-cyan/40 bg-cyan/5 px-3 py-2.5">
              <KeyRound className="size-4 shrink-0 text-cyan" aria-hidden />
              <code
                className="min-w-0 flex-1 font-mono text-base break-all text-text select-all"
                aria-label={t('secret.passwordLabel')}
              >
                {secret.password}
              </code>
              <Button
                size="sm"
                onClick={() => void copy()}
                aria-label={t('secret.copy')}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? t('common:actions.copied') : t('common:actions.copy')}
              </Button>
            </div>
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-warn"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('secret.warning')}
            </p>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
