/**
 * @fileoverview "Save as Object Set" dialog: names the current type + filter
 * + order as a reusable Object Set.
 */

import type {ObjectSetDef} from '@ontodecide/shared-kernel';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSaveObjectSet} from '../../features/object-graph/api';
import {errorMessage} from '../../shared/api/error_message';
import {useOnline} from '../../shared/lib/hooks';
import {Button} from '../../shared/ui/button';
import {Dialog, DialogContent} from '../../shared/ui/dialog';
import {Field, Input} from '../../shared/ui/input';
import {toast} from '../../shared/ui/toast';

/** Save-set dialog props. */
export interface SaveSetDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  definition: ObjectSetDef;
  onSaved?(id: string): void;
}

/** Dialog saving the current list as an Object Set. */
export function SaveSetDialog({
  open,
  onOpenChange,
  definition,
  onSaved,
}: SaveSetDialogProps) {
  const {t} = useTranslation('objects');
  const save = useSaveObjectSet();
  const online = useOnline();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    if (!n) return setError(t('list.setNameRequired'));
    if (n.length > 100) return setError(t('list.setNameTooLong'));
    setError(null);
    try {
      const s = await save.mutateAsync({name: n, definition});
      toast.success(t('list.setSaved', {name: s.name}));
      setName('');
      onOpenChange(false);
      onSaved?.(s.id);
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={t('list.saveSetTitle')}
        description={t('list.saveSetDescription')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              type="submit"
              form="save-object-set"
              loading={save.isPending}
              disabled={!online}
            >
              {t('common:actions.save')}
            </Button>
          </>
        }
      >
        <form
          id="save-object-set"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field
            label={t('list.setName')}
            htmlFor="object-set-name"
            required
            error={error ?? undefined}
          >
            <Input
              id="object-set-name"
              autoFocus
              maxLength={120}
              value={name}
              aria-invalid={!!error || undefined}
              onChange={e => setName(e.target.value)}
            />
          </Field>
          <p className="mt-2 text-xs text-dim">
            {definition.filter
              ? t('list.setIncludesFilter')
              : t('list.setNoFilter')}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
