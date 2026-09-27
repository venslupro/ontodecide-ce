/**
 * @fileoverview Confirmation dialog for admin writes. Shows the target
 * workspace id and full e-mail; creates one Idempotency-Key per opening
 * (reused for retries); high-risk actions first run a passkey user
 * verification and pass the step-up token. On passkey failure or
 * cancellation the dialog keeps what was entered.
 */

import {Fingerprint} from 'lucide-react';
import {useEffect, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {idempotencyKey} from '../../../shared/api/client';
import {errorMessage, errorTraceId} from '../../../shared/api/error_message';
import {PasskeyError, requestStepUp} from '../../../shared/webauthn';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';
import type {WriteCtx} from '../api';

/** Props of {@link AdminConfirmDialog}. */
export interface AdminConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  /** Target shown in the dialog (workspace id and e-mail). */
  target?: {tenantId?: string | null; email?: string | null};
  /** Requires a passkey step-up. */
  highRisk?: boolean;
  confirmLabel: string;
  danger?: boolean;
  /** Disables the confirm button (form invalid). */
  disabled?: boolean;
  children?: ReactNode;
  /** Performs the write; resolves when done. */
  onConfirm(w: WriteCtx): Promise<unknown>;
  onDone?(): void;
}

/** Admin write confirmation with optional passkey step-up. */
export function AdminConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  target,
  highRisk,
  confirmLabel,
  danger,
  disabled,
  children,
  onConfirm,
  onDone,
}: AdminConfirmDialogProps) {
  const {t} = useTranslation('admin');
  const [key, setKey] = useState(idempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{msg: string; trace?: string} | null>(
    null,
  );

  useEffect(() => {
    if (open) {
      setKey(idempotencyKey());
      setError(null);
    }
  }, [open]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      let stepUp: string | undefined;
      if (highRisk) stepUp = await requestStepUp();
      await onConfirm({idempotencyKey: key, stepUp});
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      if (e instanceof PasskeyError) {
        setError({msg: t('auth:passkeyFailed')});
      } else {
        setError({msg: errorMessage(e, t), trace: errorTraceId(e)});
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !busy && onOpenChange(v)}>
      <DialogContent
        title={title}
        description={description}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant={danger ? 'danger' : 'primary'}
              loading={busy}
              disabled={disabled}
              onClick={() => void run()}
            >
              {highRisk && <Fingerprint aria-hidden />}
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {target && (target.tenantId || target.email) && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[10px] border border-line-2 bg-bg-2/60 px-4 py-3 text-sm">
              {target.tenantId && (
                <>
                  <dt className="text-muted">{t('confirm.workspace')}</dt>
                  <dd className="font-mono text-text">{target.tenantId}</dd>
                </>
              )}
              <dt className="text-muted">{t('confirm.email')}</dt>
              <dd className="text-text">
                {target.email ?? t('users.deleted')}
              </dd>
            </dl>
          )}
          {children}
          {highRisk && (
            <p className="flex items-center gap-2 text-xs text-violet">
              <Fingerprint className="size-4" aria-hidden />
              {t('confirmPasskey')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-crit">
              {error.msg}
              {error.trace && (
                <span className="ml-2 font-mono text-xs text-dim">
                  traceId {error.trace}
                </span>
              )}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
