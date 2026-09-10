/**
 * JSON report rendering.
 *
 * The JSON report is the canonical form: Markdown is derived from the same
 * object, and integrations consume this one. Two properties matter more than
 * formatting:
 *
 *   - it validates against the published schema before it is written, so a
 *     malformed report is a build failure rather than a consumer's problem;
 *   - field order is fixed, so two reports of the same server diff cleanly.
 */

import { assertValidReport, REPORT_SCHEMA_VERSION, type SentinelReport } from '@sentinel-forge/shared';

/** Canonical top-level key order. Keys absent from the report stay absent. */
const KEY_ORDER: readonly (keyof SentinelReport)[] = [
  'schemaVersion',
  'generatedAt',
  'metadata',
  'server',
  'health',
  'resources',
  'findings',
  'dependencies',
  'events',
  'performance',
  'security',
  'integrity',
  'incidents',
  'limitations',
];

export function renderJsonReport(report: SentinelReport): string {
  assertValidReport(report, REPORT_SCHEMA_VERSION);

  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const value = report[key];
    if (value !== undefined) ordered[key] = value;
  }

  return `${JSON.stringify(ordered, null, 2)}\n`;
}
