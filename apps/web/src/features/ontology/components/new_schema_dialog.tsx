/**
 * @fileoverview "New ontology" dialog: api name (contract regex) and
 * bilingual display name; opens the workbench with an empty SchemaDef.
 */

import {zodResolver} from '@hookform/resolvers/zod';
import {useNavigate} from '@tanstack/react-router';
import {Plus} from 'lucide-react';
import {useId, useState} from 'react';
import {useForm} from 'react-hook-form';
import {useTranslation} from 'react-i18next';
import {z} from 'zod';
import {Button} from '../../../shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '../../../shared/ui/dialog';
import {Field, Input} from '../../../shared/ui/input';
import {API_NAME_RE, emptySchema, stashNewSchema} from '../model';

/** Dialog props. */
export interface NewSchemaDialogProps {
  /** Api names already in use. */
  existing: readonly string[];
  disabled?: boolean;
}

/** New ontology dialog with its trigger button. */
export function NewSchemaDialog({existing, disabled}: NewSchemaDialogProps) {
  const {t} = useTranslation('ontology');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ids = {api: useId(), zh: useId(), en: useId()};
  const schema = z.object({
    apiName: z
      .string()
      .regex(API_NAME_RE, t('errors.apiName'))
      .refine(v => !existing.includes(v), t('errors.apiNameTaken')),
    zh: z.string().min(1, t('errors.required')).max(100),
    en: z.string().max(100),
  });
  type Form = z.infer<typeof schema>;
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {apiName: '', zh: '', en: ''},
  });
  const {errors} = form.formState;

  const submit = form.handleSubmit(v => {
    stashNewSchema(
      emptySchema(v.apiName, {'zh-CN': v.zh, 'en-US': v.en || v.zh}),
    );
    setOpen(false);
    form.reset();
    void navigate({to: '/ontology/$api', params: {api: v.apiName}});
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" disabled={disabled}>
          <Plus aria-hidden />
          {t('index.newSchema')}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t('index.newSchema')}
        description={t('index.newSchemaDescription')}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">{t('common:actions.cancel')}</Button>
            </DialogClose>
            <Button type="submit" form="new-schema-form">
              {t('index.createAndOpen')}
            </Button>
          </>
        }
      >
        <form
          id="new-schema-form"
          className="flex flex-col gap-4"
          onSubmit={e => void submit(e)}
          noValidate
        >
          <Field
            label={t('fields.apiName')}
            htmlFor={ids.api}
            required
            error={errors.apiName?.message}
            hint={t('fields.apiNameHint')}
          >
            <Input
              id={ids.api}
              className="font-mono"
              autoComplete="off"
              aria-invalid={!!errors.apiName}
              placeholder="supplyChain"
              {...form.register('apiName')}
            />
          </Field>
          <Field
            label={`${t('fields.displayName')} · ${t('lang.zh')}`}
            htmlFor={ids.zh}
            required
            error={errors.zh?.message}
          >
            <Input
              id={ids.zh}
              aria-invalid={!!errors.zh}
              {...form.register('zh')}
            />
          </Field>
          <Field
            label={`${t('fields.displayName')} · ${t('lang.en')}`}
            htmlFor={ids.en}
          >
            <Input id={ids.en} {...form.register('en')} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
