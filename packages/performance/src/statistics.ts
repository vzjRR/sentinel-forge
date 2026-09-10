/**
 * Sample statistics.
 *
 * Regression detection is only as trustworthy as the summary it compares, so
 * the summary carries what is needed to judge it: how many samples it is drawn
 * from, and how much they vary. A mean over three noisy samples and a mean over
 * three hundred stable ones are not the same evidence, and the comparison must
 * be able to tell them apart.
 */

export interface SampleSummary {
  readonly count: number;
  readonly mean: number;
  readonly median: number;
  /** 95th percentile: what a bad tick looks like, not an average one. */
  readonly p95: number;
  readonly min: number;
  readonly max: number;
  /** Population standard deviation. */
  readonly standardDeviation: number;
  /** Standard deviation as a fraction of the mean. 0 when the mean is 0. */
  readonly coefficientOfVariation: number;
}

export const EMPTY_SUMMARY: SampleSummary = Object.freeze({
  count: 0,
  mean: 0,
  median: 0,
  p95: 0,
  min: 0,
  max: 0,
  standardDeviation: 0,
  coefficientOfVariation: 0,
});

/**
 * Summarises a set of measurements.
 *
 * Non-finite values are dropped rather than propagated: one NaN in a sample set
 * would otherwise turn every derived statistic into NaN, and a report full of
 * NaN is worse than a report that says a sample was discarded.
 */
export function summarize(values: readonly number[]): SampleSummary {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return EMPTY_SUMMARY;

  const sorted = [...clean].sort((a, b) => a - b);
  const count = sorted.length;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const mean = total / count;

  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const standardDeviation = Math.sqrt(variance);

  return {
    count,
    mean,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[count - 1] ?? 0,
    standardDeviation,
    coefficientOfVariation: mean === 0 ? 0 : standardDeviation / mean,
  };
}

/**
 * Linear-interpolated percentile over an already-sorted array.
 * Interpolating rather than picking the nearest rank keeps the value stable as
 * sample counts grow, which matters when comparing windows of different sizes.
 */
export function percentile(sorted: readonly number[], percent: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;

  const rank = (Math.min(100, Math.max(0, percent)) / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (rank - lower);
}

/** Relative change from `before` to `after`, as a fraction. */
export function relativeChange(before: number, after: number): number {
  if (before === 0) return after === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (after - before) / before;
}

/** Formats a relative change the way it is rendered in reports. */
export function formatPercentage(change: number): string {
  if (!Number.isFinite(change)) return 'not comparable';
  const sign = change > 0 ? '+' : '';
  return `${sign}${(change * 100).toFixed(2)}%`;
}
