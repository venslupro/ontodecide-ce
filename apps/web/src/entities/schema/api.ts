/**
 * @fileoverview Ontology metadata query: `GET /ontology` (the single
 * workspace version, template until the first change) mapped to UI types
 * for the current language. Cached by ETag; the ontology workbench
 * invalidates {@link ontologyKey} after each save.
 */

import type {OntologyDto} from '@ontodecide/ontology/contract';
import {useQuery} from '@tanstack/react-query';
import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {apiRequest} from '../../shared/api/client';
import {
  EMPTY_UI_MODEL,
  toUiModel,
  type UiModel,
  type UiObjectType,
} from './model';

/** Query key of the workspace ontology (prefix `ontology`). */
export const ontologyKey = () => ['ontology', 'schema'] as const;

/** Fetches the ontology; the ETag version wins over the body's `etag`. */
export async function fetchOntology(): Promise<OntologyDto> {
  const res = await apiRequest<OntologyDto>('/ontology');
  return {...res.data, etag: res.version ?? res.data.etag};
}

/** Raw ontology query. */
export function useOntology() {
  return useQuery({
    queryKey: ontologyKey(),
    queryFn: fetchOntology,
    staleTime: 5 * 60_000,
  });
}

/** UI model for the current language (memoized). */
export function useUiModel(): {
  model: UiModel;
  isLoading: boolean;
  error: unknown;
} {
  const q = useOntology();
  const {i18n} = useTranslation();
  const model = useMemo(
    () => (q.data ? toUiModel(q.data, i18n.language) : EMPTY_UI_MODEL),
    [q.data, i18n.language],
  );
  return {model, isLoading: q.isLoading, error: q.error};
}

/** One UI object type (undefined while loading or unknown). */
export function useObjectType(apiName: string | undefined): {
  type?: UiObjectType;
  isLoading: boolean;
  error: unknown;
} {
  const {model, isLoading, error} = useUiModel();
  return {
    type: apiName ? model.byName[apiName] : undefined,
    isLoading,
    error,
  };
}
