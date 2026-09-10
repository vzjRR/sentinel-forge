/**
 * Regression detection.
 *
 * The hard part of this rule is not noticing that a number went up. It is
 * refusing to report the many cases where a number going up means nothing:
 *
 *   - **A large percentage on a tiny absolute value.** 0.01 ms to 0.04 ms is
 *     +300% and is not worth an operator's attention. An absolute threshold is
 *     therefore required as well as a relative one.
 *   - **Too few samples.** Two measurements either side prove nothing.
 *   - **A noisy baseline.** If the "before" window varied by 80% of its own
 *     mean, a 40% shift is inside the noise.
 *   - **A different context.** A window recorded with 60 players is not
 *     comparable with one recorded with 3.
 *
 * Each of those is a documented false positive of PERF-REGRESSION-001, and each
 * is handled explicitly here rather than being left to a threshold to absorb.
 */

import { createFinding, type Clock } from '@sentinel-forge/core';
import type { Finding } from '@sentinel-forge/shared';
import { formatPercentage, relativeChange, summarize, type SampleSummary } from './statistics.js';

export interface RegressionThresholds {
  /** Minimum absolute increase, in the sample's unit, before a change counts. */
  readonly minimumAbsoluteIncrease: number;
  /** Minimum relative increase, as a fraction. 0.5 = 50%. */
  readonly minimumRelativeIncrease: number;
  /** Minimum samples required on each side of the comparison. */
  readonly minimumSamples: number;
  /**
   * Maximum coefficient of variation in the baseline window before it is
   * treated as too noisy to compare against.
   */
  readonly maximumBaselineVariation: number;
  /**
   * Maximum difference in mean player count between the two windows before the
   * comparison is treated as context-mismatched. `undefined` disables the check.
   */
  readonly maximumPlayerCountDelta?: number;
}

/**
 * Defaults chosen for FiveM resource tick times in milliseconds.
 *
 * 0.2 ms is around the point where a resource becomes visible in a profiler on
 * a busy server; 50% is a change large enough not to be routine drift; eight
 * samples is the fewest that makes a mean worth quoting.
 */
export const DEFAULT_THRESHOLDS: RegressionThresholds = Object.freeze({
  minimumAbsoluteIncrease: 0.2,
  minimumRelativeIncrease: 0.5,
  minimumSamples: 8,
  maximumBaselineVariation: 0.75,
});

export type RegressionVerdict =
  | 'REGRESSION'
  | 'IMPROVEMENT'
  | 'UNCHANGED'
  | 'BELOW_ABSOLUTE_THRESHOLD'
  | 'BELOW_RELATIVE_THRESHOLD'
  | 'INSUFFICIENT_SAMPLES'
  | 'BASELINE_TOO_NOISY'
  | 'CONTEXT_MISMATCH';

export interface ComparisonInput {
  readonly resource: string;
  readonly metric: string;
  readonly unit: string;
  readonly baselineValues: readonly number[];
  readonly currentValues: readonly number[];
  /** Mean player count in each window, when it was recorded. */
  readonly baselinePlayerCount?: number;
  readonly currentPlayerCount?: number;
}

export interface ComparisonResult {
  readonly resource: string;
  readonly metric: string;
  readonly unit: string;
  readonly baseline: SampleSummary;
  readonly current: SampleSummary;
  readonly absoluteChange: number;
  readonly relativeChange: number;
  readonly verdict: RegressionVerdict;
  /** Why this verdict was reached, in one sentence. */
  readonly explanation: string;
  /** 0–1, meaningful only for a REGRESSION or IMPROVEMENT verdict. */
  readonly confidence: number;
}

export function compareSamples(input: ComparisonInput, thresholds = DEFAULT_THRESHOLDS): ComparisonResult {
  const baseline = summarize(input.baselineValues);
  const current = summarize(input.currentValues);
  const absoluteChange = current.mean - baseline.mean;
  const relative = relativeChange(baseline.mean, current.mean);

  const base = {
    resource: input.resource,
    metric: input.metric,
    unit: input.unit,
    baseline,
    current,
    absoluteChange,
    relativeChange: relative,
  };

  if (baseline.count < thresholds.minimumSamples || current.count < thresholds.minimumSamples) {
    return {
      ...base,
      verdict: 'INSUFFICIENT_SAMPLES',
      explanation: `Not enough samples to compare: ${String(baseline.count)} before and ${String(
        current.count,
      )} after, against a minimum of ${String(thresholds.minimumSamples)} on each side.`,
      confidence: 0,
    };
  }

  if (
    thresholds.maximumPlayerCountDelta !== undefined &&
    input.baselinePlayerCount !== undefined &&
    input.currentPlayerCount !== undefined &&
    Math.abs(input.currentPlayerCount - input.baselinePlayerCount) > thresholds.maximumPlayerCountDelta
  ) {
    return {
      ...base,
      verdict: 'CONTEXT_MISMATCH',
      explanation: `The two windows were recorded under different load (${String(
        input.baselinePlayerCount,
      )} players against ${String(input.currentPlayerCount)}), so the difference cannot be attributed to a change in the resource.`,
      confidence: 0,
    };
  }

  if (baseline.coefficientOfVariation > thresholds.maximumBaselineVariation) {
    return {
      ...base,
      verdict: 'BASELINE_TOO_NOISY',
      explanation: `The baseline window varies by ${formatPercentage(
        baseline.coefficientOfVariation,
      )} of its own mean, which is too unstable to compare against.`,
      confidence: 0,
    };
  }

  if (absoluteChange < 0 && Math.abs(relative) >= thresholds.minimumRelativeIncrease) {
    return {
      ...base,
      verdict: 'IMPROVEMENT',
      explanation: `Mean ${input.metric} fell from ${baseline.mean.toFixed(3)} to ${current.mean.toFixed(3)} ${input.unit} (${formatPercentage(relative)}).`,
      confidence: confidenceFor(baseline, current, Math.abs(relative)),
    };
  }

  if (absoluteChange < thresholds.minimumAbsoluteIncrease) {
    return {
      ...base,
      verdict: absoluteChange <= 0 ? 'UNCHANGED' : 'BELOW_ABSOLUTE_THRESHOLD',
      explanation:
        absoluteChange <= 0
          ? `Mean ${input.metric} did not increase.`
          : `Mean ${input.metric} rose by ${absoluteChange.toFixed(3)} ${input.unit}, below the ${String(
              thresholds.minimumAbsoluteIncrease,
            )} ${input.unit} threshold. A large percentage on a small value is not a meaningful regression.`,
      confidence: 0,
    };
  }

  if (relative < thresholds.minimumRelativeIncrease) {
    return {
      ...base,
      verdict: 'BELOW_RELATIVE_THRESHOLD',
      explanation: `Mean ${input.metric} rose by ${formatPercentage(relative)}, below the ${formatPercentage(
        thresholds.minimumRelativeIncrease,
      )} threshold.`,
      confidence: 0,
    };
  }

  return {
    ...base,
    verdict: 'REGRESSION',
    explanation: `Mean ${input.metric} rose from ${baseline.mean.toFixed(3)} to ${current.mean.toFixed(3)} ${input.unit} (${formatPercentage(
      relative,
    )}), across ${String(baseline.count)} and ${String(current.count)} samples.`,
    confidence: confidenceFor(baseline, current, relative),
  };
}

/**
 * Confidence in a detected change.
 *
 * Three inputs move it: how many samples support each side, how stable those
 * samples were, and how far apart the two means are relative to that spread.
 * A change of five standard deviations on hundreds of stable samples is close
 * to certain; a change of half a standard deviation on nine noisy ones is not.
 */
function confidenceFor(baseline: SampleSummary, current: SampleSummary, relative: number): number {
  const spread = Math.max(baseline.standardDeviation, current.standardDeviation, Number.EPSILON);
  const separation = Math.abs(current.mean - baseline.mean) / spread;

  // Each term saturates, so no single input can carry the result on its own.
  const separationTerm = Math.min(1, separation / 3);
  const sampleTerm = Math.min(1, Math.min(baseline.count, current.count) / 60);
  const magnitudeTerm = Math.min(1, Math.abs(relative) / 2);

  const score = 0.5 * separationTerm + 0.3 * sampleTerm + 0.2 * magnitudeTerm;
  // Never claim more than high confidence from recorded samples alone: the
  // cause of the change is still unestablished.
  return Math.round(Math.min(0.9, Math.max(0.25, score)) * 100) / 100;
}

export interface RegressionFindingInput {
  readonly comparison: ComparisonResult;
  readonly baselineLabel: string;
  readonly comparisonLabel: string;
  readonly clock: Clock;
}

/** Builds PERF-REGRESSION-001 for a comparison whose verdict is REGRESSION. */
export function toRegressionFinding(input: RegressionFindingInput): Finding | null {
  const { comparison } = input;
  if (comparison.verdict !== 'REGRESSION') return null;

  return createFinding({
    ruleId: 'PERF-REGRESSION-001',
    // A doubling is a different matter from a 60% rise, and the severity says so.
    severity: comparison.relativeChange >= 1 ? 'HIGH' : 'MEDIUM',
    confidence: comparison.confidence,
    title: 'Resource timing regression against baseline',
    summary: `${comparison.resource}: ${comparison.explanation} Evidence indicates a regression relative to baseline "${input.baselineLabel}".`,
    recommendation: `Compare what changed in ${comparison.resource} between the two baselines (\`sentinel compare ${input.baselineLabel} ${input.comparisonLabel}\`), then inspect the paths that run every tick.`,
    evidence: [
      {
        kind: 'MEASUREMENT',
        description: `Mean ${comparison.metric} in baseline "${input.baselineLabel}".`,
        measurement: {
          value: Number(comparison.baseline.mean.toFixed(4)),
          unit: comparison.unit,
          sampleCount: comparison.baseline.count,
        },
      },
      {
        kind: 'MEASUREMENT',
        description: `Mean ${comparison.metric} in "${input.comparisonLabel}".`,
        measurement: {
          value: Number(comparison.current.mean.toFixed(4)),
          unit: comparison.unit,
          sampleCount: comparison.current.count,
          baselineValue: Number(comparison.baseline.mean.toFixed(4)),
        },
      },
      {
        kind: 'MEASUREMENT',
        description: 'Spread of the baseline window, as a fraction of its mean.',
        measurement: {
          value: Number(comparison.baseline.coefficientOfVariation.toFixed(4)),
          unit: 'ratio',
          sampleCount: comparison.baseline.count,
        },
      },
    ],
    resource: comparison.resource,
    timestamp: input.clock.now().toISOString(),
    discriminator: `${input.baselineLabel}->${input.comparisonLabel}:${comparison.metric}`,
    metadata: {
      metric: comparison.metric,
      unit: comparison.unit,
      baselineMean: Number(comparison.baseline.mean.toFixed(4)),
      currentMean: Number(comparison.current.mean.toFixed(4)),
      relativeChange: Number(comparison.relativeChange.toFixed(4)),
      baselineSamples: comparison.baseline.count,
      currentSamples: comparison.current.count,
    },
  });
}
