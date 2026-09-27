/**
 * @fileoverview Cloudflare GraphQL Analytics adapter: today's account-wide
 * Worker invocations, D1 rows written, Workers AI neurons and Queue
 * operations (read-only token CF_ANALYTICS_TOKEN). A response with
 * `errors`, without the account or with a dataset / field this adapter does
 * not know throws, so the cron keeps the last snapshot instead of reading
 * zeros (a schema change shows up as `analytics.failed`).
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

type Groups = {sum?: Record<string, unknown>}[] | undefined;

/** Dataset alias → summed field of the query above. */
const FIELDS = {
  workers: 'requests',
  d1: 'rowsWritten',
  ai: 'totalNeurons',
  queues: 'billableOperations',
} as const;

function total(groups: Groups, alias: keyof typeof FIELDS): number {
  if (!Array.isArray(groups)) {
    throw new Error(`analytics schema: ${alias} missing`);
  }
  const field = FIELDS[alias];
  return groups.reduce((a, g) => {
    const v = g?.sum?.[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`analytics schema: ${alias}.${field}`);
    }
    return a + v;
  }, 0);
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
      data?: {viewer?: {accounts?: Record<string, Groups>[]} | null} | null;
      errors?: unknown[] | null;
    };
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      throw new Error(`analytics errors: ${body.errors.length}`);
    }
    const acc = body.data?.viewer?.accounts?.[0];
    if (!acc) throw new Error('analytics schema: account missing');
    return {
      workers: total(acc['workers'], 'workers'),
      d1Writes: total(acc['d1'], 'd1'),
      neurons: total(acc['ai'], 'ai'),
      queues: total(acc['queues'], 'queues'),
    };
  }
}
