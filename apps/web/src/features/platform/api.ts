/**
 * @fileoverview Runtime platform config (feature flags from KV).
 */

import {useQuery} from '@tanstack/react-query';
import {api} from '../../shared/api/client';
import {qk, STALE} from '../../shared/api/query_keys';

/** `/config` response. */
export interface PlatformConfig {
  features: Record<string, boolean>;
  version?: string;
}

/** Feature flags; failures resolve to defaults (all on). */
export function useConfig() {
  return useQuery({
    queryKey: qk.config(),
    queryFn: async () => {
      try {
        return await api.get<PlatformConfig>('/config', {
          auth: false,
          retryOn401: false,
        });
      } catch {
        return {features: {}} as PlatformConfig;
      }
    },
    staleTime: STALE.config,
  });
}

/** Whether a feature flag is on (unknown flags default to on). */
export function useFeature(name: string): boolean {
  const {data} = useConfig();
  return data?.features?.[name] ?? true;
}
