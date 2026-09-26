/**
 * @fileoverview Edits a user's markings (replaces the full set).
 */

import type {UserDto} from '@ontodecide/identity/contract';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {errorMessage} from '../../../shared/api/error_message';
import {useOnline} from '../../../shared/lib/hooks';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogClose, DialogContent} from '../../../shared/ui/dialog';
import {Field} from '../../../shared/ui/input';
import {toast} from '../../../shared/ui/toast';
import {ChipsInput} from '../../ontology/components/chips_input';
import {useGrantMarkings} from '../api';

/** Markings editor dialog. */
export function MarkingsDialog({
  user,
  suggestions,
  onClose,
}: {
  user: UserDto | null;
  suggestions: readonly string[];
  onClose(): void;
}) {
  const {t} = useTranslation('admin');
  const online = useOnline();
  const grant = useGrantMarkings();
  const {reset} = grant;
  const [value, setValue] = useState<string[]>([]);
  useEffect(() => {
    setValue(user?.markings ?? []);
    reset();
  }, [user, reset]);

  const save = () => {
    if (!user) return;
    grant.mutate(
      {id: user.id, markings: value},
      {
        onSuccess: () => {
          toast.success(t('markings.saved', {name: user.name}));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={!!user} onOpenChange={o => !o && onClose()}>
      {user && (
        <DialogContent
          title={t('markings.title', {name: user.name})}
          description={t('markings.description')}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost">{t('common:actions.cancel')}</Button>
              </DialogClose>
              <Button
                variant="primary"
                onClick={save}
                loading={grant.isPending}
                disabled={!online}
              >
                {t('common:actions.save')}
              </Button>
            </>
          }
        >
          <Field label={t('fields.markings')} hint={t('markings.hint')}>
            <ChipsInput
              tone="orange"
              value={value}
              onChange={setValue}
              suggestions={suggestions}
              label={t('fields.markingsInput')}
              removeLabel={v => t('markings.remove', {value: v})}
              placeholder={t('markings.placeholder')}
            />
          </Field>
          {grant.isError && (
            <p role="alert" className="mt-3 text-sm text-crit">
              {errorMessage(grant.error, t)}
            </p>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
