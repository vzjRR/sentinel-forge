/**
 * Finding model — the central diagnostic record of Sentinel Forge.
 *
 * A finding states what was *detected* or *observed*, backed by evidence.
 * Findings must not assert causation, guaranteed exploitability, or malice.
 */

import type { Evidence } from './evidence.js';
import type { RuleCategory } from './rules/catalog.js';
import type { Severity } from './severity.js';

export interface Finding {
  /** Stable identifier for this finding instance (deterministic per scan input). */
  readonly id: string;
  /** Catalog rule identifier, e.g. `DEP-MISSING-001`. */
  readonly ruleId: string;
  readonly category: RuleCategory;
  readonly severity: Severity;
  /** 0.00–1.00. See `confidence.ts`. */
  readonly confidence: number;
  /** Short, neutral headline. */
  readonly title: string;
  /** One or two sentences describing what was observed. */
  readonly summary: string;
  /** Actionable next step for a human. Never phrased as a guarantee. */
  readonly recommendation: string;
  /** Supporting evidence. Required for every severity above INFO. */
  readonly evidence: readonly Evidence[];
  /** Owning resource name, when the finding is resource-scoped. */
  readonly resource?: string;
  /** Primary file the finding points at (server-relative POSIX path). */
  readonly file?: string;
  /** Primary 1-based line, when applicable. */
  readonly line?: number;
  /** ISO-8601 timestamp of when the finding was produced. */
  readonly timestamp: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/** A finding plus the scan run it belongs to, as persisted in the local database. */
export interface StoredFinding extends Finding {
  readonly scanRunId: string;
  readonly serverId: string;
}

export interface FindingSummary {
  readonly total: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
  readonly byCategory: Readonly<Record<string, number>>;
}

/**
 * Deterministic ordering for report output: severity descending, then
 * confidence descending, then ruleId, resource, file and line ascending.
 * Two identical scans must produce byte-identical ordering.
 */
export function compareFindings(a: Finding, b: Finding): number {
  const severityOrder: Record<Severity, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    INFO: 0,
  };
  const bySeverity = severityOrder[b.severity] - severityOrder[a.severity];
  if (bySeverity !== 0) return bySeverity;
  const byConfidence = b.confidence - a.confidence;
  if (byConfidence !== 0) return byConfidence;
  const byRule = a.ruleId.localeCompare(b.ruleId);
  if (byRule !== 0) return byRule;
  const byResource = (a.resource ?? '').localeCompare(b.resource ?? '');
  if (byResource !== 0) return byResource;
  const byFile = (a.file ?? '').localeCompare(b.file ?? '');
  if (byFile !== 0) return byFile;
  return (a.line ?? 0) - (b.line ?? 0);
}
