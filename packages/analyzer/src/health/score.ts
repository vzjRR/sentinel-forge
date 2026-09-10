/**
 * Health scoring.
 *
 * A health score is only worth showing if every point it deducts can be traced
 * back to a specific finding. This engine therefore computes a score *from* the
 * findings rather than alongside them: each deduction names the finding that
 * caused it, and the deductions sum to the score.
 *
 * Two properties follow deliberately:
 *
 *   - **A category with no analysis is not scored.** It is reported as
 *     unavailable with a reason. Giving an unmeasured category 100 would claim
 *     a clean result that was never checked; giving it 0 would invent a problem.
 *   - **INFO findings deduct nothing.** They are observations. A server should
 *     not lose points for using the legacy manifest format or for depending on
 *     a resource that ships with the platform.
 */

import {
  clampHealthScore,
  HEALTH_CATEGORIES,
  type CategoryHealth,
  type Finding,
  type HealthCap,
  type HealthCategory,
  type HealthDeduction,
  type HealthScore,
  type RuleCategory,
  type Severity,
} from '@sentinel-forge/shared';

/**
 * Points removed for one finding at full confidence. The values are spaced so
 * that a single HIGH finding is visible in a score without a handful of LOW
 * findings adding up to the same thing.
 */
export const SEVERITY_POINTS: Readonly<Record<Severity, number>> = Object.freeze({
  CRITICAL: 45,
  HIGH: 25,
  MEDIUM: 10,
  LOW: 4,
  INFO: 0,
});

/**
 * Category weights for the overall score, normalized across the categories that
 * were actually scored. Security and performance carry the most weight because
 * they are what takes a server down or gets it compromised.
 */
export const CATEGORY_WEIGHTS: Readonly<Record<HealthCategory, number>> = Object.freeze({
  PERFORMANCE: 25,
  SECURITY: 25,
  RELIABILITY: 15,
  DEPENDENCIES: 15,
  CONFIGURATION: 10,
  INTEGRITY: 10,
});

/** Rule categories map onto health categories one to one. */
const RULE_TO_HEALTH: Readonly<Record<RuleCategory, HealthCategory>> = Object.freeze({
  PERFORMANCE: 'PERFORMANCE',
  SECURITY: 'SECURITY',
  DEPENDENCIES: 'DEPENDENCIES',
  INTEGRITY: 'INTEGRITY',
  CONFIGURATION: 'CONFIGURATION',
  ERRORS: 'RELIABILITY',
});

/**
 * Score ceilings applied when a finding is severe enough that a high score
 * would mislead. Both are documented in docs/API.md and reported with the score.
 */
export const SCORE_CAPS = Object.freeze({
  /** Any CRITICAL finding at moderate-or-better confidence. */
  CRITICAL: { score: 40, minimumConfidence: 0.5 },
  /** Any HIGH finding at high confidence. */
  HIGH: { score: 75, minimumConfidence: 0.75 },
});

export interface HealthInput {
  readonly findings: readonly Finding[];
  /**
   * Categories this run actually analysed. Anything omitted is reported as
   * unavailable, with the reason given in `unavailableReasons`.
   */
  readonly availableCategories: readonly HealthCategory[];
  /** Why each unavailable category was not scored. */
  readonly unavailableReasons?: Readonly<Partial<Record<HealthCategory, string>>>;
}

function deductionFor(finding: Finding): HealthDeduction | null {
  const base = SEVERITY_POINTS[finding.severity];
  if (base === 0) return null;

  // Weighting by confidence keeps a low-confidence finding from moving a score
  // as much as a certain one, without hiding it.
  const points = Math.round(base * finding.confidence);
  if (points === 0) return null;

  return {
    ruleId: finding.ruleId,
    findingId: finding.id,
    severity: finding.severity,
    points,
    reason: `${finding.severity} ${finding.ruleId}: ${finding.title}`,
  };
}

function capFor(findings: readonly Finding[]): HealthCap | undefined {
  const critical = findings.find(
    (finding) => finding.severity === 'CRITICAL' && finding.confidence >= SCORE_CAPS.CRITICAL.minimumConfidence,
  );
  if (critical !== undefined) {
    return {
      appliedScore: SCORE_CAPS.CRITICAL.score,
      reason: `A CRITICAL finding caps the score at ${String(SCORE_CAPS.CRITICAL.score)}: ${critical.title}.`,
      ruleId: critical.ruleId,
    };
  }

  const high = findings.find(
    (finding) => finding.severity === 'HIGH' && finding.confidence >= SCORE_CAPS.HIGH.minimumConfidence,
  );
  if (high !== undefined) {
    return {
      appliedScore: SCORE_CAPS.HIGH.score,
      reason: `A high-confidence HIGH finding caps the score at ${String(SCORE_CAPS.HIGH.score)}: ${high.title}.`,
      ruleId: high.ruleId,
    };
  }

  return undefined;
}

/**
 * Computes a health score from findings.
 *
 * @param input.findings - Findings in scope. For a resource score, pass only
 *   that resource's findings.
 */
export function computeHealth(input: HealthInput): HealthScore {
  const available = new Set(input.availableCategories);
  const byCategory = new Map<HealthCategory, HealthDeduction[]>();

  for (const category of HEALTH_CATEGORIES) byCategory.set(category, []);

  for (const finding of input.findings) {
    const category = RULE_TO_HEALTH[finding.category];
    const deduction = deductionFor(finding);
    if (deduction === null) continue;
    byCategory.get(category)?.push(deduction);
  }

  const categories: CategoryHealth[] = [];
  for (const category of HEALTH_CATEGORIES) {
    if (!available.has(category)) continue;
    const deductions = (byCategory.get(category) ?? []).sort((a, b) => b.points - a.points);
    const total = deductions.reduce((sum, deduction) => sum + deduction.points, 0);
    categories.push({ category, score: clampHealthScore(100 - total), deductions });
  }

  const totalWeight = categories.reduce((sum, entry) => sum + CATEGORY_WEIGHTS[entry.category], 0);
  const weighted =
    totalWeight === 0
      ? 100
      : categories.reduce((sum, entry) => sum + entry.score * CATEGORY_WEIGHTS[entry.category], 0) / totalWeight;

  const cap = capFor(input.findings);
  const score = cap === undefined ? clampHealthScore(weighted) : Math.min(clampHealthScore(weighted), cap.appliedScore);

  const unavailable: Record<string, string> = {};
  for (const category of HEALTH_CATEGORIES) {
    if (available.has(category)) continue;
    unavailable[category] =
      input.unavailableReasons?.[category] ?? 'Not analyzed by this build. See docs/GATE_STATUS.md.';
  }

  return {
    score,
    categories,
    primaryReasons: primaryReasons(categories, cap),
    ...(cap === undefined ? {} : { cap }),
    complete: Object.keys(unavailable).length === 0,
    ...(Object.keys(unavailable).length === 0 ? {} : { unavailable }),
  };
}

/**
 * The reasons a reader needs first: the heaviest deductions, grouped so that
 * "12 configuration warnings" reads as one line rather than twelve.
 */
function primaryReasons(categories: readonly CategoryHealth[], cap: HealthCap | undefined): string[] {
  const reasons: string[] = [];
  if (cap !== undefined) reasons.push(cap.reason);

  const bySeverity = new Map<string, { count: number; points: number }>();
  for (const category of categories) {
    for (const deduction of category.deductions) {
      const key = `${deduction.severity}|${deduction.ruleId}`;
      const entry = bySeverity.get(key) ?? { count: 0, points: 0 };
      entry.count += 1;
      entry.points += deduction.points;
      bySeverity.set(key, entry);
    }
  }

  const ranked = [...bySeverity.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, 5);
  for (const [key, entry] of ranked) {
    const [severity, ruleId] = key.split('|');
    reasons.push(
      `${severity ?? ''}: ${String(entry.count)} ${ruleId ?? ''} finding${entry.count === 1 ? '' : 's'} (-${String(entry.points)})`,
    );
  }

  if (reasons.length === 0) reasons.push('No findings deducted from this score.');
  return reasons;
}

/** Health for one resource, computed from the findings scoped to it. */
export function computeResourceHealth(
  resource: string,
  findings: readonly Finding[],
  availableCategories: readonly HealthCategory[],
  unavailableReasons?: Readonly<Partial<Record<HealthCategory, string>>>,
): HealthScore {
  return computeHealth({
    findings: findings.filter((finding) => finding.resource === resource),
    availableCategories,
    ...(unavailableReasons === undefined ? {} : { unavailableReasons }),
  });
}
