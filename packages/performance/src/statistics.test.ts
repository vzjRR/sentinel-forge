import { describe, expect, it } from 'vitest';
import { EMPTY_SUMMARY, formatPercentage, percentile, relativeChange, summarize } from './statistics.js';

describe('sample statistics', () => {
  it('summarises a simple set', () => {
    const summary = summarize([1, 2, 3, 4, 5]);
    expect(summary).toMatchObject({ count: 5, mean: 3, median: 3, min: 1, max: 5 });
  });

  it('returns the empty summary for no samples rather than NaN', () => {
    expect(summarize([])).toEqual(EMPTY_SUMMARY);
  });

  it('drops non-finite values instead of poisoning every derived statistic', () => {
    const summary = summarize([1, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(summary.count).toBe(2);
    expect(summary.mean).toBe(2);
  });

  it('computes an interpolated percentile', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
  });

  it('reports p95 above the median for a skewed set', () => {
    const summary = summarize([1, 1, 1, 1, 1, 1, 1, 1, 1, 20]);
    expect(summary.p95).toBeGreaterThan(summary.median);
  });

  it('computes standard deviation and its ratio to the mean', () => {
    const stable = summarize([10, 10, 10, 10]);
    const noisy = summarize([1, 10, 1, 10]);
    expect(stable.standardDeviation).toBe(0);
    expect(stable.coefficientOfVariation).toBe(0);
    expect(noisy.coefficientOfVariation).toBeGreaterThan(0.5);
  });

  it('treats a zero mean without dividing by zero', () => {
    expect(summarize([0, 0, 0]).coefficientOfVariation).toBe(0);
    expect(relativeChange(0, 0)).toBe(0);
    expect(relativeChange(0, 5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('formats a relative change the way reports render it', () => {
    expect(formatPercentage(3.1429)).toBe('+314.29%');
    expect(formatPercentage(-0.5)).toBe('-50.00%');
    expect(formatPercentage(Number.POSITIVE_INFINITY)).toBe('not comparable');
  });
});
