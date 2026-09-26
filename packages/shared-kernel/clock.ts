/**
 * @fileoverview Injectable clock so time-dependent logic is testable.
 */

/** Source of the current time. */
export interface Clock {
  now(): Date;
}

/** Wall-clock implementation. */
export const systemClock: Clock = {now: () => new Date()};

/** A clock fixed at (and advanceable from) a given instant; for tests. */
export class FixedClock implements Clock {
  private t: number;
  constructor(start: Date | string | number = '2026-09-24T00:00:00Z') {
    this.t = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  /** Moves the clock forward. */
  advance(ms: number): void {
    this.t += ms;
  }
}

/** UTC day key `YYYY-MM-DD`. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
