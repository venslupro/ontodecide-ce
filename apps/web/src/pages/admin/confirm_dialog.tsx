/**
 * @fileoverview Confirmation dialog used by the admin pages, optionally
 * requiring the user to type a phrase (e.g. an email) before confirming.
 */

import {useEffect, useId, useState, type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {Button} from '../../shared/ui/button';
import {Dialog, DialogClose, DialogContent} from '../../shared/ui/dialog';
import {Field, Input} from '../../shared/ui/input';

/** Confirm dialog props. */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm(): void;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  disabled?: boolean;
  /** When set, the confirm button stays disabled until this is typed. */
  typeToConfirm?: string;
  typeLabel?: string;
  children?: ReactNode;
}

/** A confirmation dialog. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = 'primary',
  loading,
  disabled,
  typeToConfirm,
  typeLabel,
  children,
}: ConfirmDialogProps) {
  const {t} = useTranslation('common');
  const id = useId();
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const matches = !typeToConfirm || typed.trim() === typeToConfirm;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={title}
        description={description}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">{t('actions.cancel')}</Button>
            </DialogClose>
            <Button
              variant={tone}
              loading={loading}
              disabled={disabled || !matches}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {children}
        {typeToConfirm && (
          <Field
            label={typeLabel ?? typeToConfirm}
            htmlFor={id}
            className={children ? 'mt-3' : undefined}
          >
            <Input
              id={id}
              autoComplete="off"
              value={typed}
              placeholder={typeToConfirm}
              onChange={e => setTyped(e.target.value)}
            />
          </Field>
        )}
      </DialogContent>
    </Dialog>
  );
}
