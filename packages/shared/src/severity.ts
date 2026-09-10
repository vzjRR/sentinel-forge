/**
 * Severity model.
 *
 * Severity answers: "how much does this matter if the finding is real?"
 * It is deliberately independent from {@link Confidence}, which answers
 * "how sure are we that the finding is real?".
 */

export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type Severity = (typeof SEVERITIES)[number];

/** Ordinal rank, ascending by impact. Used for sorting and thresholds only. */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

/** Negative if `a` is less severe than `b`; suitable for `Array.prototype.sort`. */
export function compareSeverity(a: Severity, b: Severity): number {
  return severityRank(a) - severityRank(b);
}

export function isAtLeastSeverity(value: Severity, minimum: Severity): boolean {
  return severityRank(value) >= severityRank(minimum);
}

export function maxSeverity(severities: readonly Severity[]): Severity | undefined {
  let current: Severity | undefined;
  for (const severity of severities) {
    if (current === undefined || severityRank(severity) > severityRank(current)) {
      current = severity;
    }
  }
  return current;
}

/** Zeroed counter for every severity level. Callers may mutate the returned object. */
export function emptySeverityCounts(): Record<Severity, number> {
  return { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
}

export function countBySeverity(items: readonly { severity: Severity }[]): Record<Severity, number> {
  const counts = emptySeverityCounts();
  for (const item of items) {
    counts[item.severity] += 1;
  }
  return counts;
}
