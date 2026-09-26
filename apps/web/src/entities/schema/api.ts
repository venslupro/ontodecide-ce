/**
 * @fileoverview Schema metadata queries: the active compiled model mapped to
 * UI types for the current language and markings.
 */

import type {CompiledModel, SchemaDto} from '@ontodecide/ontology/contract';
import {useQuery} from '@tanstack/react-query';
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {api} from '../../shared/api/client';
import {isApiError} from '../../shared/api/errors';
import {qk, STALE} from '../../shared/api/query_keys';
import {useSession} from '../session/store';
import {
  EMPTY_UI_MODEL,
  toUiModel,
  type UiModel,
  type UiObjectType,
} from './model';

/** Fetches the active compiled model (404 → empty model). */
export async function fetchModel(): Promise<CompiledModel | null> {
  try {
    return await api.get<CompiledModel>('/ontology/model');
  } catch (e) {
    if (isApiError(e, 'NOT_FOUND', 'ONTOLOGY_INVALID')) return null;
    throw e;
  }
}

/** Raw compiled model query. */
export function useCompiledModel() {
  return useQuery({
    queryKey: qk.model(),
    queryFn: fetchModel,
    staleTime: STALE.model,
  });
}

/** UI model for the current language (memoized). */
export function useUiModel(): {
  model: UiModel;
  isLoading: boolean;
  error: unknown;
} {
  const q = useCompiledModel();
  const {i18n} = useTranslation();
  const markings = useSession(s => s.user?.markings);
  const model = useMemo(
    () =>
      q.data
        ? toUiModel(q.data, i18n.language, markings ?? [])
        : EMPTY_UI_MODEL,
    [q.data, i18n.language, markings],
  );
  return {model, isLoading: q.isLoading, error: q.error};
}

/** One UI object type (undefined while loading or unknown). */
export function useObjectType(api: string | undefined): {
  type?: UiObjectType;
  isLoading: boolean;
  error: unknown;
} {
  const {model, isLoading, error} = useUiModel();
  return {type: api ? model.byName[api] : undefined, isLoading, error};
}

/** A specific schema version; versioned schemas never go stale. */
export function useSchema(apiName: string | undefined, version = 'current') {
  return useQuery({
    queryKey: qk.schema(apiName ?? '', version),
    queryFn: () =>
      api.get<SchemaDto>(`/ontology/schemas/${encodeURIComponent(apiName!)}`, {
        query: {version},
      }),
    enabled: !!apiName,
    staleTime: /^\d+\.\d+\.\d+$/.test(version) ? STALE.schemaVersioned : 30_000,
  });
}
