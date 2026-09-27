/**
 * @fileoverview /archive-deletions/:token: landing page of the archive
 * e-mail's "delete now" link (前端详细设计 6.3.6). The token is read once,
 * removed from the address bar with history.replaceState and kept only in
 * memory. GET shows size and scheduled deletion; after the confirmation
 * checkbox a POST (with Idempotency-Key) deletes the ZIP.
 */

import {useMutation, useQuery} from '@tanstack/react-query';
import {Link, useParams} from '@tanstack/react-router';
import {Trash2} from 'lucide-react';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {deleteArchive, getArchiveDeletion} from '../../features/identity/api';
import {idempotencyKey} from '../../shared/api/client';
import {isApiError} from '../../shared/api/errors';
import {errorMessage} from '../../shared/api/error_message';
import {qk} from '../../shared/api/query_keys';
import {fmt} from '../../shared/lib/format';
import {Button} from '../../shared/ui/button';
import {Checkbox, Label} from '../../shared/ui/input';
import {Spinner} from '../../shared/ui/skeleton';
import {PublicShell} from '../ended/public_shell';

let memoToken: string | null = null;

/** Reads the token once and strips it from the URL (Referer / history). */
export function takeToken(fromRoute: string | undefined): string | null {
  if (fromRoute && fromRoute !== 'used') {
    memoToken = fromRoute;
    try {
      history.replaceState(history.state, '', '/archive-deletions/used');
    } catch {
      // Non-browser environment.
    }
  }
  return memoToken;
}

/** Archive deletion confirmation page. */
export function ArchiveDeletionPage() {
  const {t} = useTranslation('auth');
  const params = useParams({strict: false}) as {token?: string};
  const [token] = useState(() => takeToken(params.token));
  const [confirmed, setConfirmed] = useState(false);
  const [key] = useState(idempotencyKey);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const info = useQuery({
    queryKey: qk.archiveDeletion(token ?? ''),
    queryFn: () => getArchiveDeletion(token!),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });
  const del = useMutation({mutationFn: () => deleteArchive(token!, key)});

  const invalid =
    !token || (info.isError && isApiError(info.error, 'NOT_FOUND'));

  let right;
  if (del.isSuccess) {
    right = (
      <div role="status" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text">
          {t('archiveDeletion.doneTitle')}
        </h2>
        <p className="text-sm text-muted">{t('archiveDeletion.done')}</p>
      </div>
    );
  } else if (invalid) {
    right = (
      <div role="alert" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-text">
          {t('archiveDeletion.invalidTitle')}
        </h2>
        <p className="text-sm text-muted">{t('archiveDeletion.invalid')}</p>
      </div>
    );
  } else if (info.isError) {
    right = (
      <p role="alert" className="text-sm text-crit">
        {errorMessage(info.error, t)}
      </p>
    );
  } else if (!info.data) {
    right = <Spinner />;
  } else {
    right = (
      <div className="flex flex-col gap-5">
        <h2 className="text-base font-semibold text-text">
          {t('archiveDeletion.cardTitle')}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted">{t('archiveDeletion.size')}</dt>
          <dd className="num text-text">{fmt.bytes(info.data.sizeBytes)}</dd>
          <dt className="text-muted">{t('archiveDeletion.scheduled')}</dt>
          <dd className="num text-text">
            {fmt.dateTimeTz(info.data.expiresAt, tz)}{' '}
            <span className="text-dim">
              ({fmt.tzName(info.data.expiresAt, tz)})
            </span>
          </dd>
        </dl>
        <div className="danger-zone flex items-start gap-3 p-4">
          <Checkbox
            id="confirm-delete"
            checked={confirmed}
            onCheckedChange={v => setConfirmed(v === true)}
          />
          <Label
            htmlFor="confirm-delete"
            className="text-sm leading-relaxed text-text"
          >
            {t('archiveDeletion.confirm')}
          </Label>
        </div>
        {del.isError && (
          <p role="alert" className="text-sm text-crit">
            {isApiError(del.error, 'NOT_FOUND')
              ? t('archiveDeletion.invalid')
              : errorMessage(del.error, t)}
          </p>
        )}
        <Button
          variant="danger"
          size="lg"
          disabled={!confirmed}
          loading={del.isPending}
          onClick={() => del.mutate()}
        >
          <Trash2 aria-hidden />
          {t('archiveDeletion.submit')}
        </Button>
      </div>
    );
  }

  return (
    <PublicShell
      left={
        <>
          <h1 className="text-4xl leading-tight font-bold tracking-tight text-text">
            {t('archiveDeletion.title')}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted">
            {t('archiveDeletion.body')}
          </p>
          <div>
            <Button asChild variant="outline">
              <Link to="/signup">{t('ended.signupAgain')}</Link>
            </Button>
          </div>
        </>
      }
      right={right}
    />
  );
}
