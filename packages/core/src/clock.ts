/**
 * Clock abstraction.
 *
 * Timestamps appear in findings, reports and database rows. Injecting the clock
 * keeps tests deterministic and keeps report snapshots comparable.
 */

export interface Clock {
  now(): Date;
  /** Monotonic milliseconds, for durations unaffected by wall-clock changes. */
  monotonicMs(): number;
}

export const systemClock: Clock = Object.freeze({
  now(): Date {
    return new Date();
  },
  monotonicMs(): number {
    return Math.round(performance.now());
  },
});

/** Fixed clock for tests. `advance` moves both wall and monotonic time. */
export function createFixedClock(start: Date): Clock & { advance(ms: number): void } {
  let current = start.getTime();
  return {
    now(): Date {
      return new Date(current);
    },
    monotonicMs(): number {
      return current;
    },
    advance(ms: number): void {
      current += ms;
    },
  };
}

/** ISO-8601 with millisecond precision: the timestamp format used everywhere. */
export function toIsoTimestamp(date: Date): string {
  return date.toISOString();
}
