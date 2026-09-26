/**
 * @fileoverview Create-user dialog (contract `createUserInputSchema`):
 * email, name, role, markings and an optional initial password. Reports the
 * created user and the one-time temporary password (if any) to the caller.
 */

import {zodResolver} from '@hookform/resolvers/zod';
import {
  createUserInputSchema,
  type UserDto,
} from '@ontodecide/identity/contract';
import {ROLES} from '@ontodecide/shared-kernel';
import {UserPlus} from 'lucide-react';
import {useId, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import type {z} from 'zod';
import {errorMessage} from '../../../shared/api/error_message';
import {useOnline} from '../../../shared/lib/hooks';
import {Button} from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '../../../shared/ui/dialog';
import {Field, Input} from '../../../shared/ui/input';
import {NativeSelect} from '../../../shared/ui/select';
import {ChipsInput} from '../../ontology/components/chips_input';
import {useCreateUser} from '../api';

type CreateForm = z.input<typeof createUserInputSchema>;

/** Create-user dialog props. */
export interface CreateUserDialogProps {
  markingSuggestions: readonly string[];
  onCreated(user: UserDto, temporaryPassword?: string): void;
}

/** Create-user dialog with its trigger button. */
export function CreateUserDialog({
  markingSuggestions,
  onCreated,
}: CreateUserDialogProps) {
  const {t} = useTranslation('admin');
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const create = useCreateUser();
  const ids = {
    email: useId(),
    name: useId(),
    role: useId(),
    markings: useId(),
    password: useId(),
  };
  const form = useForm<CreateForm>({
    resolver: zodResolver(createUserInputSchema),
    defaultValues: {email: '', name: '', role: 'Viewer', markings: []},
  });
  const {errors} = form.formState;

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      form.reset();
      create.reset();
    }
  };

  const submit = form.handleSubmit(v => {
    create.mutate(
      {...v, markings: v.markings?.length ? v.markings : undefined},
      {
        onSuccess: r => {
          onOpenChange(false);
          onCreated(r.user, r.temporaryPassword);
        },
      },
    );
  });

  const pwMessage = errors.password ? t('errors.password') : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary" disabled={!online}>
          <UserPlus aria-hidden />
          {t('users.create')}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t('users.create')}
        description={t('create.description')}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button
              type="submit"
              form="create-user-form"
              loading={create.isPending}
              disabled={!online}
            >
              {t('common:actions.create')}
            </Button>
          </>
        }
      >
        <form
          id="create-user-form"
          className="flex flex-col gap-4"
          onSubmit={e => void submit(e)}
          noValidate
        >
          <Field
            label={t('fields.email')}
            htmlFor={ids.email}
            required
            error={errors.email && t('errors.email')}
          >
            <Input
              id={ids.email}
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.email}
              {...form.register('email')}
            />
          </Field>
          <Field
            label={t('fields.name')}
            htmlFor={ids.name}
            required
            error={errors.name && t('errors.name')}
          >
            <Input
              id={ids.name}
              autoComplete="off"
              aria-invalid={!!errors.name}
              {...form.register('name')}
            />
          </Field>
          <Field
            label={t('fields.role')}
            htmlFor={ids.role}
            required
            hint={t('create.roleHint')}
          >
            <NativeSelect
              id={ids.role}
              options={ROLES.map(r => ({
                value: r,
                label: t(`common:roles.${r}`),
              }))}
              {...form.register('role')}
            />
          </Field>
          <Field label={t('fields.markings')} hint={t('markings.hint')}>
            <Controller
              control={form.control}
              name="markings"
              render={({field}) => (
                <ChipsInput
                  tone="orange"
                  value={field.value}
                  onChange={field.onChange}
                  suggestions={markingSuggestions}
                  label={t('fields.markingsInput')}
                  removeLabel={v => t('markings.remove', {value: v})}
                  placeholder={t('markings.placeholder')}
                />
              )}
            />
          </Field>
          <Field
            label={t('fields.password')}
            htmlFor={ids.password}
            error={pwMessage}
            hint={t('create.passwordHint')}
          >
            <Input
              id={ids.password}
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...form.register('password', {
                setValueAs: v => (v ? v : undefined),
              })}
            />
          </Field>
          {create.isError && (
            <p role="alert" className="text-sm text-crit">
              {errorMessage(create.error, t)}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
