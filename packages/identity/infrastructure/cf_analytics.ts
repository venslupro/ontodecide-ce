/**
 * @fileoverview Cloudflare GraphQL Analytics adapter: today's account-wide
 * Worker invocations, D1 rows written, Workers AI neurons and Queue
 * operations (read-only token CF_ANALYTICS_TOKEN). Unknown datasets count
 * as 0 so a schema change never blocks the cron.
 */

import type {AnalyticsMetric} from '../domain';
import type {AnalyticsPort} from '../application';

/** GraphQL endpoint. */
export const CF_GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

const QUERY = `query Usage($account: string!, $day: Date!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      workers: workersInvocationsAdaptive(limit: 10000, filter: {date: $day}) { sum { requests } }
      d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date: $day}) { sum { rowsWritten } }
      ai: aiInferenceAdaptiveGroups(limit: 10000, filter: {date: $day}) { sum { totalNeurons } }
      queues: queueMessageOperationsAdaptiveGroups(limit: 10000, filter: {date: $day}) { sum { billableOperations } }
    }
  }
}`;

type Groups = {sum?: Record<string, number>}[] | undefined;

function total(groups: Groups, field: string): number {
  return (groups ?? []).reduce((a, g) => a + (g.sum?.[field] ?? 0), 0);
}

/** Reads daily totals from GraphQL Analytics. */
export class CloudflareAnalytics implements AnalyticsPort {
  constructor(
    private readonly accountId: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async dailyUsage(
    day: string,
  ): Promise<Partial<Record<AnalyticsMetric, number>>> {
    const res = await this.fetchFn(CF_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: QUERY,
        variables: {account: this.accountId, day},
      }),
    });
    if (!res.ok) throw new Error(`analytics ${res.status}`);
    const body = (await res.json()) as {
      data?: {viewer?: {accounts?: Record<string, Groups>[]}};
    };
    const acc = body.data?.viewer?.accounts?.[0] ?? {};
    return {
      workers: total(acc['workers'], 'requests'),
      d1Writes: total(acc['d1'], 'rowsWritten'),
      neurons: total(acc['ai'], 'totalNeurons'),
      queues: total(acc['queues'], 'billableOperations'),
    };
  }
}
