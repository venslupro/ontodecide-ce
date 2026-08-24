/**
 * Generic mock helpers used during UI development and tests.
 *
 * The helpers here intentionally have no dependency on any domain type so
 * they can be reused across pages. Seeded list generation uses a tiny LCG
 * to keep the output deterministic across runs / tests.
 */

/**
 * Creates a deterministic list of mock items by invoking {@code factory}
 * repeatedly. A lightweight LCG seeded from {@code seed} advances before
 * each factory call, so the same (factory, length, seed) triple always
 * produces identical values.
 *
 * @param factory Callback used to build a single item. It receives the
 *     0-based index and the current 31-bit pseudo-random value in [0,1).
 * @param length Number of items to generate (defaults to 5).
 * @param seed Initial seed for the LCG; defaults to 1.
 * @returns An array of exactly {@code length} items.
 */
export function mockList<T>(
  factory: (index: number, random: number) => T,
  length = 5,
  seed = 1,
): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    // Mulberry32-style step, normalized into [0,1).
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const items: T[] = [];
  const count = Math.max(0, Math.floor(length));
  for (let i = 0; i < count; i += 1) {
    items.push(factory(i, next()));
  }
  return items;
}

/**
 * Wraps a promise, returning its result on success or {@code fallback} on
 * rejection. Rejections are surfaced via the optional {@code onError}
 * callback and are always logged via {@code console.warn}.
 *
 * @param promise Promise to await.
 * @param fallback Value returned when {@code promise} rejects.
 * @param onError Optional callback invoked with the rejection reason.
 * @returns A promise that always resolves — either to the original value
 *     or to {@code fallback}.
 */
export async function wrapAsync<T>(
  promise: Promise<T>,
  fallback: T,
  onError?: (err: unknown) => void,
): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.warn('[wrapAsync] promise rejected:', err);
    try {
      onError?.(err);
    } catch {
      // Swallow secondary errors raised by the callback.
    }
    return fallback;
  }
}
