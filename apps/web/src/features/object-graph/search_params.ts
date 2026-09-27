/**
 * @fileoverview Loose URL search-param helpers for business pages. Pages
 * read params with `useSearch({strict: false})` (the router may or may not
 * validate them) and patch them without losing the others.
 */

import {useNavigate, useSearch} from '@tanstack/react-router';
import {useCallback} from 'react';

/** Current search params as a plain record. */
export function useLooseSearch(): Record<string, unknown> {
  return useSearch({strict: false}) as Record<string, unknown>;
}

/** Returns a function merging `patch` into the search (undefined removes). */
export function useSearchPatch(): (
  patch: Record<string, unknown>,
  opts?: {replace?: boolean},
) => void {
  const navigate = useNavigate();
  return useCallback(
    (patch, opts) => {
      void navigate({
        to: '.',
        replace: opts?.replace ?? true,
        search: ((prev: Record<string, unknown>) => {
          const next: Record<string, unknown> = {...prev, ...patch};
          for (const [k, v] of Object.entries(next))
            if (v === undefined || v === '' || v === null) delete next[k];
          return next;
        }) as never,
      });
    },
    [navigate],
  );
}

/** Reads a string search param. */
export function searchString(
  search: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = search[key];
  if (typeof v === 'string') return v || undefined;
  if (typeof v === 'number') return String(v);
  return undefined;
}
