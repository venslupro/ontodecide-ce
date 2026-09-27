/**
 * @fileoverview Delete confirmation for a definition. For object types it
 * first loads `GET /objects/stats` and warns with the number of objects of
 * that type, and lists the definitions that still reference it (the server
 * rejects deletions that would leave dangling references).
 */

import type {DefKind, OntologyDef} from '@ontodecide/ontology/contract';
import {AlertTriangle, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useObjectStats} from '../../object-graph/api';
import {errorMessage} from '../../../shared/api/error_message';
import {Button} from '../../../shared/ui/button';
import {Dialog, DialogContent} from '../../../shared/ui/dialog';
import {Spinner} from '../../../shared/ui/skeleton';
import {referencesTo} from '../model';

/** Dialog props. */
export interface DeleteDefinitionDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  kind: DefKind;
  id: string;
  label: string;
  ontology: OntologyDef;
  pending: boolean;
  error: unknown;
  onConfirm(): void;
}

/** The dialog. */
export function DeleteDefinitionDialog({
  open,
  onOpenChange,
  kind,
  id,
  label,
  ontology,
  pending,
  error,
  onConfirm,
}: DeleteDefinitionDialogProps) {
  const {t} = useTranslation('ontology');
  const isType = kind === 'object-types';
  const stats = useObjectStats(open && isType);
  const count = stats.data?.byType[id] ?? 0;
  const refs = isType ? referencesTo(ontology, id) : null;
  const refList = refs
    ? [...refs.links, ...refs.actions, ...refs.properties]
    : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={t('delete.title', {name: label})}
        description={t(`delete.description.${kind}`)}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={isType && stats.isLoading}
              onClick={onConfirm}
            >
              <Trash2 aria-hidden />
              {t('actions.delete')}
            </Button>
          </>
        }
      >
        {isType && (
          <div className="flex flex-col gap-2 text-sm">
            {stats.isLoading ? (
              <p className="flex items-center gap-2 text-muted">
                <Spinner />
                {t('delete.loadingStats')}
              </p>
            ) : stats.isError ? (
              <p role="alert" className="text-crit">
                {errorMessage(stats.error, t)}
              </p>
            ) : (
              <p
                data-testid="delete-object-count"
                className={count > 0 ? 'flex gap-2 text-warn' : 'text-muted'}
              >
                {count > 0 && (
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                )}
                {t('delete.objectCount', {count})}
              </p>
            )}
            <p className="text-xs text-muted">{t('delete.dangling')}</p>
            {refList.length > 0 && (
              <div className="text-xs">
                <p className="text-warn">{t('delete.references')}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {refList.map(r => (
                    <li
                      key={r}
                      className="rounded border border-line-2 px-1.5 font-mono text-dim"
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-crit">
            {errorMessage(error, t)}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
