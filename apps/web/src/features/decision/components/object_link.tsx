/**
 * @fileoverview Link to an object's Object View, showing its title (given, or
 * fetched through the object query) and falling back to a short RID.
 */

import {Link} from '@tanstack/react-router';
import {useObject} from '../../object-graph/api';
import {cn} from '../../../shared/lib/cn';
import {shortRid} from '../model';

/** Title of an object (fetched when not provided); RID short form while unknown. */
export function useObjectTitle(
  rid: string | undefined,
  known?: string,
): string {
  const q = useObject(known ? undefined : rid, 1);
  if (known) return known;
  return q.data?.title ?? (rid ? shortRid(rid) : '—');
}

/** Link to `/objects/rid/$rid` (optionally deep-linking a property via `hash`). */
export function ObjectLink({
  rid,
  title,
  hash,
  className,
}: {
  rid: string;
  title?: string;
  hash?: string;
  className?: string;
}) {
  const text = useObjectTitle(rid, title);
  return (
    <Link
      to="/objects/rid/$rid"
      params={{rid}}
      hash={hash}
      title={rid}
      className={cn(
        'text-cyan underline-offset-2 hover:underline break-words',
        className,
      )}
    >
      {text}
    </Link>
  );
}
