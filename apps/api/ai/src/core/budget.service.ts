/**
 * Neuron-budget manager.
 *
 * Tracks the daily Neuron (token) usage against the Workers AI free-tier
 * limit. When a call would exceed the soft limit, the manager invokes a
 * fallback (typically a cached or rule-based response) instead of letting
 * the third-party call fail mid-flight.
 *
 * The counter is stored in KV under `neuron:<YYYY-MM-DD>` and auto-evicts
 * after 26 hours so stale data never causes false rejections.
 */
import { CACHE_KEYS, CACHE_TTL, CONFIG, dayKey } from '@ontodecide/shared';

export class NeuronBudgetManager {
  constructor(private readonly cache: KVNamespace) {}

  /** Read the current daily usage (in Neurons). */
  public async usedToday(): Promise<number> {
    const raw = await this.cache.get(CACHE_KEYS.neuronDaily(dayKey()));
    return raw ? parseInt(raw, 10) : 0;
  }

  /** Check whether `cost` Neurons can be spent right now. */
  public async canSpend(cost: number): Promise<boolean> {
    const used = await this.usedToday();
    return used + cost <= CONFIG.NEURON_DAILY_LIMIT;
  }

  /**
   * Execute `fn`, falling back to `fallbackFn` when the budget would be
   * exceeded. The actual usage is recorded only when `fn` returns the
   * real usage via the result; otherwise the pre-estimated `cost` is used.
   */
  public async executeWithBudget<T>(
    estimatedCost: number,
    fn: () => Promise<{ result: T; actualCost?: number }>,
    fallbackFn: () => Promise<T>,
  ): Promise<T> {
    const used = await this.usedToday();
    if (used + estimatedCost > CONFIG.NEURON_DAILY_LIMIT) {
      return fallbackFn();
    }
    try {
      const { result, actualCost } = await fn();
      const cost = actualCost ?? estimatedCost;
      await this.cache.put(CACHE_KEYS.neuronDaily(dayKey()), String(used + cost), {
        expirationTtl: CACHE_TTL.NEURON_DAILY,
      });
      return result;
    } catch (err) {
      // Do not deduct anything when the call failed: the provider did not
      // bill us (or the discrepancy is acceptable on the free tier).
      throw err;
    }
  }
}
