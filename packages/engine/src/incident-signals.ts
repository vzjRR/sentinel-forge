/**
 * Turning a baseline comparison into correlation signals.
 *
 * The incident engine works on signals with timestamps. A comparison of two
 * baselines is exactly that: a set of changes that happened between two known
 * times, alongside the effects observed at the later one.
 *
 * The timestamps used are the baselines' own capture times. That is coarser
 * than runtime telemetry (GATE 5) and the wording downstream reflects it: these
 * observations are related in a window, not at an instant.
 */

import type { BaselineComparison } from '@sentinel-forge/performance';
import type { Signal } from '@sentinel-forge/incidents';

export function signalsFromComparison(comparison: BaselineComparison): Signal[] {
  const changedAt = comparison.after.createdAt;
  const signals: Signal[] = [];

  for (const change of comparison.resourceChanges) {
    if (change.kind === 'UNCHANGED') continue;
    signals.push({
      kind:
        change.kind === 'ADDED' ? 'RESOURCE_ADDED' : change.kind === 'REMOVED' ? 'RESOURCE_REMOVED' : 'RESOURCE_CHANGED',
      occurredAt: changedAt,
      resource: change.resource,
      description: `${change.resource} ${change.kind.toLowerCase()}`,
      metadata: { details: change.details.join(' ') },
    });
  }

  if (comparison.configurationChanged) {
    signals.push({
      kind: 'CONFIG_CHANGED',
      occurredAt: changedAt,
      description: 'server configuration changed',
    });
  }

  for (const change of comparison.findingChanges) {
    if (change.kind !== 'INTRODUCED') continue;
    signals.push({
      kind: 'FINDING_INTRODUCED',
      occurredAt: changedAt,
      ...(change.resource === undefined ? {} : { resource: change.resource }),
      description: `new finding ${change.ruleId} (${change.title})`,
      findingId: change.findingId,
    });
  }

  for (const regression of comparison.performance.regressions) {
    signals.push({
      kind: 'PERFORMANCE_REGRESSION',
      occurredAt: changedAt,
      resource: regression.resource,
      description: `${regression.metric} regression in ${regression.resource}`,
      metadata: {
        baselineMean: Number(regression.baseline.mean.toFixed(4)),
        currentMean: Number(regression.current.mean.toFixed(4)),
      },
    });
  }

  if (comparison.healthDelta !== undefined && comparison.healthDelta < 0) {
    signals.push({
      kind: 'HEALTH_DROP',
      occurredAt: changedAt,
      description: `health score fell by ${String(Math.abs(comparison.healthDelta))} points`,
      metadata: { delta: comparison.healthDelta },
    });
  }

  return signals;
}
