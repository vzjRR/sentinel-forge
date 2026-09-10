/**
 * Health scoring contracts.
 *
 * A health score is only meaningful if every point deducted can be traced back
 * to a finding. The scoring engine is delivered in GATE 2
 * (`@sentinel-forge/analyzer`); this module defines the contract it must meet.
 */

import type { Severity } from './severity.js';

export const HEALTH_CATEGORIES = [
  'PERFORMANCE',
  'RELIABILITY',
  'SECURITY',
  'DEPENDENCIES',
  'INTEGRITY',
  'CONFIGURATION',
] as const;

export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];

export const HEALTH_SCORE_MIN = 0;
export const HEALTH_SCORE_MAX = 100;

/** One traceable deduction. The sum of deductions explains the score. */
export interface HealthDeduction {
  readonly ruleId: string;
  readonly findingId: string;
  readonly severity: Severity;
  /** Points removed from the category score. Always positive. */
  readonly points: number;
  readonly reason: string;
}

/**
 * A documented ceiling applied because a finding is severe enough that a high
 * score would be misleading. Caps are always reported alongside the score.
 */
export interface HealthCap {
  readonly appliedScore: number;
  readonly reason: string;
  readonly ruleId: string;
}

export interface CategoryHealth {
  readonly category: HealthCategory;
  readonly score: number;
  readonly deductions: readonly HealthDeduction[];
}

export interface HealthScore {
  /** 0–100, after category weighting and any cap. */
  readonly score: number;
  readonly categories: readonly CategoryHealth[];
  /** Human-readable primary reasons, ordered by impact. */
  readonly primaryReasons: readonly string[];
  readonly cap?: HealthCap;
  /**
   * `false` when insufficient data was available to score a category
   * (for example: no baseline recorded). Never substitute a guessed value.
   */
  readonly complete: boolean;
  /** Categories that could not be scored, with the reason why. */
  readonly unavailable?: Readonly<Record<string, string>>;
}

export function isHealthCategory(value: unknown): value is HealthCategory {
  return typeof value === 'string' && (HEALTH_CATEGORIES as readonly string[]).includes(value);
}

export function isValidHealthScore(value: number): boolean {
  return Number.isInteger(value) && value >= HEALTH_SCORE_MIN && value <= HEALTH_SCORE_MAX;
}

export function clampHealthScore(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError('Health score must be a finite number.');
  }
  return Math.min(HEALTH_SCORE_MAX, Math.max(HEALTH_SCORE_MIN, Math.round(value)));
}
