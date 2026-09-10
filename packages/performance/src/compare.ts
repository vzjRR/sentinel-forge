/**
 * Baseline comparison.
 *
 * Answers "what changed between these two points" across four axes: the
 * resource inventory, resource content, the findings, and — when samples exist
 * on both sides — measured performance.
 *
 * The performance axis reports honestly when it has nothing to compare. A
 * comparison that quietly omits a section it could not compute would read as
 * "no regressions found", which is a different statement from "no measurements
 * were available".
 */

import type { Clock } from '@sentinel-forge/core';
import type { Finding } from '@sentinel-forge/shared';
import {
  type BaselineFindingEntry,
  type BaselineRecord,
  type BaselineResourceEntry,
} from './baseline.js';
import { compareSamples, toRegressionFinding, type ComparisonResult, type RegressionThresholds } from './regression.js';

export type ResourceChangeKind = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

export interface ResourceChange {
  readonly resource: string;
  readonly kind: ResourceChangeKind;
  readonly before?: BaselineResourceEntry;
  readonly after?: BaselineResourceEntry;
  /** What differed, for a MODIFIED resource. */
  readonly details: readonly string[];
}

export interface FindingChange {
  readonly kind: 'INTRODUCED' | 'RESOLVED';
  readonly findingId: string;
  readonly ruleId: string;
  readonly severity: string;
  readonly resource?: string;
  readonly title: string;
}

export interface PerformanceComparisonSection {
  /** False when either side recorded no samples. */
  readonly compared: boolean;
  readonly reason?: string;
  readonly results: readonly ComparisonResult[];
  readonly regressions: readonly ComparisonResult[];
  readonly improvements: readonly ComparisonResult[];
}

export interface BaselineComparison {
  readonly before: BaselineRecord;
  readonly after: BaselineRecord;
  readonly resourceChanges: readonly ResourceChange[];
  readonly configurationChanged: boolean;
  readonly findingChanges: readonly FindingChange[];
  readonly healthDelta?: number;
  readonly performance: PerformanceComparisonSection;
  /** Findings produced by the comparison itself, e.g. regressions. */
  readonly findings: readonly Finding[];
}

export interface CompareBaselinesInput {
  readonly before: BaselineRecord;
  readonly after: BaselineRecord;
  readonly beforeResources: readonly BaselineResourceEntry[];
  readonly afterResources: readonly BaselineResourceEntry[];
  readonly beforeFindings: readonly BaselineFindingEntry[];
  readonly afterFindings: readonly BaselineFindingEntry[];
  /** Measured samples per resource and metric, when a collector supplied them. */
  readonly beforeSamples?: readonly { resource: string; metric: string; unit: string; value: number }[];
  readonly afterSamples?: readonly { resource: string; metric: string; unit: string; value: number }[];
  readonly thresholds?: RegressionThresholds;
  readonly clock: Clock;
}

export function compareBaselines(input: CompareBaselinesInput): BaselineComparison {
  const resourceChanges = compareResources(input.beforeResources, input.afterResources);
  const findingChanges = compareFindings(input.beforeFindings, input.afterFindings);
  const performance = comparePerformance(input);

  const findings = performance.regressions
    .map((comparison) =>
      toRegressionFinding({
        comparison,
        baselineLabel: input.before.label,
        comparisonLabel: input.after.label,
        clock: input.clock,
      }),
    )
    .filter((finding): finding is Finding => finding !== null);

  return {
    before: input.before,
    after: input.after,
    resourceChanges,
    configurationChanged:
      input.before.configFingerprint !== undefined &&
      input.after.configFingerprint !== undefined &&
      input.before.configFingerprint !== input.after.configFingerprint,
    findingChanges,
    ...(input.before.healthScore === undefined || input.after.healthScore === undefined
      ? {}
      : { healthDelta: input.after.healthScore - input.before.healthScore }),
    performance,
    findings,
  };
}

function compareResources(
  before: readonly BaselineResourceEntry[],
  after: readonly BaselineResourceEntry[],
): ResourceChange[] {
  const beforeByName = new Map(before.map((entry) => [entry.resource, entry]));
  const afterByName = new Map(after.map((entry) => [entry.resource, entry]));
  const names = [...new Set([...beforeByName.keys(), ...afterByName.keys()])].sort((a, b) => a.localeCompare(b));

  const changes: ResourceChange[] = [];

  for (const name of names) {
    const previous = beforeByName.get(name);
    const current = afterByName.get(name);

    if (previous === undefined && current !== undefined) {
      changes.push({ resource: name, kind: 'ADDED', after: current, details: ['Resource is present only in the later baseline.'] });
      continue;
    }
    if (previous !== undefined && current === undefined) {
      changes.push({ resource: name, kind: 'REMOVED', before: previous, details: ['Resource is present only in the earlier baseline.'] });
      continue;
    }
    if (previous === undefined || current === undefined) continue;

    const details: string[] = [];
    if (previous.contentHash !== current.contentHash) details.push('File contents changed.');
    if (previous.fileCount !== current.fileCount) {
      details.push(`File count changed from ${String(previous.fileCount)} to ${String(current.fileCount)}.`);
    }
    if (previous.totalBytes !== current.totalBytes) {
      details.push(`Total size changed from ${String(previous.totalBytes)} to ${String(current.totalBytes)} bytes.`);
    }
    if (previous.version !== current.version) {
      details.push(`Declared version changed from ${previous.version ?? 'none'} to ${current.version ?? 'none'}.`);
    }

    changes.push({
      resource: name,
      kind: details.length === 0 ? 'UNCHANGED' : 'MODIFIED',
      before: previous,
      after: current,
      details,
    });
  }

  return changes;
}

function compareFindings(
  before: readonly BaselineFindingEntry[],
  after: readonly BaselineFindingEntry[],
): FindingChange[] {
  const beforeIds = new Map(before.map((entry) => [entry.findingId, entry]));
  const afterIds = new Map(after.map((entry) => [entry.findingId, entry]));
  const changes: FindingChange[] = [];

  for (const [id, entry] of afterIds) {
    if (beforeIds.has(id)) continue;
    changes.push({
      kind: 'INTRODUCED',
      findingId: id,
      ruleId: entry.ruleId,
      severity: entry.severity,
      ...(entry.resource === undefined ? {} : { resource: entry.resource }),
      title: entry.title,
    });
  }

  for (const [id, entry] of beforeIds) {
    if (afterIds.has(id)) continue;
    changes.push({
      kind: 'RESOLVED',
      findingId: id,
      ruleId: entry.ruleId,
      severity: entry.severity,
      ...(entry.resource === undefined ? {} : { resource: entry.resource }),
      title: entry.title,
    });
  }

  return changes.sort((a, b) => a.kind.localeCompare(b.kind) || a.findingId.localeCompare(b.findingId));
}

function comparePerformance(input: CompareBaselinesInput): PerformanceComparisonSection {
  const before = input.beforeSamples ?? [];
  const after = input.afterSamples ?? [];

  if (before.length === 0 || after.length === 0) {
    return {
      compared: false,
      reason:
        before.length === 0 && after.length === 0
          ? 'No performance samples were recorded for either baseline. Timing data requires the runtime collector (GATE 5); this comparison covers resource content, configuration and findings only.'
          : `Performance samples were recorded for only one of the two baselines (${String(before.length)} and ${String(after.length)}), so no comparison is possible.`,
      results: [],
      regressions: [],
      improvements: [],
    };
  }

  const key = (sample: { resource: string; metric: string }): string => `${sample.resource}|${sample.metric}`;
  const grouped = new Map<string, { resource: string; metric: string; unit: string; before: number[]; after: number[] }>();

  for (const sample of before) {
    const entry = grouped.get(key(sample)) ?? {
      resource: sample.resource,
      metric: sample.metric,
      unit: sample.unit,
      before: [],
      after: [],
    };
    entry.before.push(sample.value);
    grouped.set(key(sample), entry);
  }
  for (const sample of after) {
    const entry = grouped.get(key(sample)) ?? {
      resource: sample.resource,
      metric: sample.metric,
      unit: sample.unit,
      before: [],
      after: [],
    };
    entry.after.push(sample.value);
    grouped.set(key(sample), entry);
  }

  const results = [...grouped.values()]
    .sort((a, b) => a.resource.localeCompare(b.resource) || a.metric.localeCompare(b.metric))
    .map((entry) =>
      compareSamples(
        {
          resource: entry.resource,
          metric: entry.metric,
          unit: entry.unit,
          baselineValues: entry.before,
          currentValues: entry.after,
        },
        input.thresholds,
      ),
    );

  return {
    compared: true,
    results,
    regressions: results.filter((result) => result.verdict === 'REGRESSION'),
    improvements: results.filter((result) => result.verdict === 'IMPROVEMENT'),
  };
}
