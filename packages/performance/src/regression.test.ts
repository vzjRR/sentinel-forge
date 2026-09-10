import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@sentinel-forge/core';
import { compareSamples, DEFAULT_THRESHOLDS, toRegressionFinding } from './regression.js';

const clock = createFixedClock(new Date('2026-01-01T00:00:00.000Z'));

/**
 * A stable sample set around `mean`. The jitter is proportional (2% of the
 * mean), because a fixed absolute jitter would make a small mean look wildly
 * noisy and trip the variation check before the threshold under test.
 */
function stable(mean: number, count = 30): number[] {
  const jitter = Math.abs(mean) * 0.02;
  return Array.from({ length: count }, (_value, index) => mean + (index % 2 === 0 ? jitter : -jitter));
}

function compare(before: number[], after: number[], overrides = {}): ReturnType<typeof compareSamples> {
  return compareSamples(
    { resource: 'sf_test', metric: 'tick time', unit: 'ms', baselineValues: before, currentValues: after },
    { ...DEFAULT_THRESHOLDS, ...overrides },
  );
}

describe('regression detection', () => {
  it('detects a clear regression', () => {
    const result = compare(stable(0.21), stable(0.87));
    expect(result.verdict).toBe('REGRESSION');
    expect(result.relativeChange).toBeCloseTo(3.14, 1);
    expect(result.explanation).toContain('rose from');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('does NOT report a large percentage on a tiny absolute value', () => {
    // 0.01 ms to 0.04 ms is +300% and means nothing on a real server. This is
    // the documented false positive that the absolute threshold exists for.
    const result = compare(stable(0.01), stable(0.04));
    expect(result.verdict).toBe('BELOW_ABSOLUTE_THRESHOLD');
    expect(result.explanation).toContain('not a meaningful regression');
    expect(result.confidence).toBe(0);
  });

  it('does not report a change below the relative threshold', () => {
    const result = compare(stable(2), stable(2.5));
    expect(result.verdict).toBe('BELOW_RELATIVE_THRESHOLD');
  });

  it('refuses to compare too few samples', () => {
    const result = compare([0.2, 0.2, 0.2], [2, 2, 2]);
    expect(result.verdict).toBe('INSUFFICIENT_SAMPLES');
    expect(result.explanation).toContain('minimum');
    expect(result.confidence).toBe(0);
  });

  it('refuses to compare against a noisy baseline', () => {
    const noisy = Array.from({ length: 30 }, (_value, index) => (index % 2 === 0 ? 0.1 : 5));
    const result = compare(noisy, stable(4));
    expect(result.verdict).toBe('BASELINE_TOO_NOISY');
    expect(result.explanation).toContain('too unstable');
  });

  it('refuses to compare windows recorded under different load', () => {
    const result = compareSamples(
      {
        resource: 'sf_test',
        metric: 'tick time',
        unit: 'ms',
        baselineValues: stable(0.2),
        currentValues: stable(1.5),
        baselinePlayerCount: 4,
        currentPlayerCount: 58,
      },
      { ...DEFAULT_THRESHOLDS, maximumPlayerCountDelta: 20 },
    );
    expect(result.verdict).toBe('CONTEXT_MISMATCH');
    expect(result.explanation).toContain('different load');
  });

  it('reports an improvement rather than calling every change a regression', () => {
    const result = compare(stable(2), stable(0.5));
    expect(result.verdict).toBe('IMPROVEMENT');
    expect(result.explanation).toContain('fell from');
  });

  it('reports no change when nothing moved', () => {
    expect(compare(stable(1), stable(1)).verdict).toBe('UNCHANGED');
  });

  it('raises confidence with more samples and a cleaner separation', () => {
    const few = compare(stable(0.2, 10), stable(1.2, 10));
    const many = compare(stable(0.2, 200), stable(1.2, 200));
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });

  it('never claims certainty from recorded samples alone', () => {
    // The cause of the change is still unestablished, however clean the data.
    const result = compare(stable(0.2, 500), stable(20, 500));
    expect(result.confidence).toBeLessThanOrEqual(0.9);
  });

  it('builds a finding only for a regression verdict', () => {
    const regression = compare(stable(0.21), stable(0.87));
    const unchanged = compare(stable(1), stable(1));

    expect(toRegressionFinding({ comparison: unchanged, baselineLabel: 'a', comparisonLabel: 'b', clock })).toBeNull();

    const finding = toRegressionFinding({ comparison: regression, baselineLabel: 'a', comparisonLabel: 'b', clock });
    expect(finding).not.toBeNull();
    expect(finding).toMatchObject({ ruleId: 'PERF-REGRESSION-001', resource: 'sf_test' });
    expect(finding?.summary).toContain('Evidence indicates');
    // The wording must stay short of claiming a cause.
    expect(finding?.summary).not.toMatch(/caused by|because of/i);
  });

  it('carries the measurements, sample counts and baseline value as evidence', () => {
    const finding = toRegressionFinding({
      comparison: compare(stable(0.21), stable(0.87)),
      baselineLabel: 'before',
      comparisonLabel: 'after',
      clock,
    });
    const measurements = finding?.evidence.filter((evidence) => evidence.kind === 'MEASUREMENT') ?? [];
    expect(measurements.length).toBeGreaterThanOrEqual(3);
    expect(measurements[1]?.measurement?.baselineValue).toBeCloseTo(0.21, 2);
    expect(measurements[1]?.measurement?.sampleCount).toBe(30);
  });

  it('treats a doubling as more severe than a smaller rise', () => {
    const doubled = toRegressionFinding({
      comparison: compare(stable(1), stable(3)),
      baselineLabel: 'a',
      comparisonLabel: 'b',
      clock,
    });
    const smaller = toRegressionFinding({
      comparison: compare(stable(1), stable(1.7)),
      baselineLabel: 'a',
      comparisonLabel: 'b',
      clock,
    });
    expect(doubled?.severity).toBe('HIGH');
    expect(smaller?.severity).toBe('MEDIUM');
  });
});
