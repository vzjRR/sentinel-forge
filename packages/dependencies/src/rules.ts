/**
 * Dependency rules.
 *
 * DEP-MISSING-001  a declared or discovered dependency was not found
 * DEP-CYCLE-001    the dependency graph contains a cycle
 */

import { createFinding, type Clock } from '@sentinel-forge/core';
import type { Finding } from '@sentinel-forge/shared';
import type { DependencyGraph } from './graph.js';

export interface DependencyRuleContext {
  readonly graph: DependencyGraph;
  /**
   * Names known to be provided by the platform rather than the operator.
   * A dependency on one of these is expected to be unresolved in a scan that
   * only covers the operator's own resource directories.
   */
  readonly platformResources: ReadonlySet<string>;
  /** Server-relative manifest path per resource, for evidence locations. */
  readonly manifestPaths: ReadonlyMap<string, string>;
  readonly clock: Clock;
}

export function analyzeDependencies(context: DependencyRuleContext): Finding[] {
  return [...analyzeMissing(context), ...analyzeCycles(context)];
}

function analyzeMissing(context: DependencyRuleContext): Finding[] {
  const timestamp = context.clock.now().toISOString();
  const findings: Finding[] = [];

  for (const edge of context.graph.unresolved) {
    const platform = context.platformResources.has(edge.to.toLowerCase());
    const file = context.manifestPaths.get(edge.from) ?? edge.declaredIn;
    const discovered = edge.kind === 'DISCOVERED';

    findings.push(
      createFinding({
        ruleId: 'DEP-MISSING-001',
        // A dependency on a resource shipped with the official server data set
        // is expected to be absent when only the operator's directories are
        // scanned, so it is recorded rather than raised.
        severity: platform ? 'INFO' : 'HIGH',
        confidence: platform ? 0.2 : discovered ? 0.85 : 0.95,
        title: platform
          ? 'Dependency is provided by the server data set'
          : discovered
            ? 'Referenced resource was not found'
            : 'Declared dependency was not found',
        summary: platform
          ? `"${edge.from}" depends on "${edge.to}", which is part of the official server data set and was not found in the scanned directories.`
          : discovered
            ? `"${edge.from}" loads a file from "${edge.to}" using an @resource reference, but "${edge.to}" was not found in the scanned resource directories.`
            : `"${edge.from}" declares a dependency on "${edge.to}", which was not found in the scanned resource directories.`,
        recommendation: platform
          ? 'No action needed if the server data set is installed outside the scanned directories. Add its directory to server.resourceDirectories to include it in analysis.'
          : `Install or enable "${edge.to}", or remove the reference if it is obsolete.`,
        evidence: [
          {
            kind: 'RELATIONSHIP',
            description: `${edge.kind === 'DECLARED' ? 'Declared' : 'Discovered'} dependency edge that could not be resolved.`,
            ...(file === undefined || edge.line === undefined ? {} : { location: { file, line: edge.line } }),
            metadata: { from: edge.from, to: edge.to, kind: edge.kind },
          },
          {
            kind: 'CONFIG_VALUE',
            description: 'Resources discovered in the scanned directories.',
            metadata: { discoveredResourceCount: context.graph.nodes.length },
          },
        ],
        resource: edge.from,
        ...(file === undefined ? {} : { file }),
        ...(edge.line === undefined ? {} : { line: edge.line }),
        timestamp,
        discriminator: `${edge.to}:${edge.kind}`,
        metadata: { dependency: edge.to, kind: edge.kind },
      }),
    );
  }

  return findings;
}

function analyzeCycles(context: DependencyRuleContext): Finding[] {
  const timestamp = context.clock.now().toISOString();

  return context.graph.cycles.map((cycle) => {
    const rendered = [...cycle, cycle[0] ?? ''].join(' -> ');
    const owner = cycle[0] ?? '';
    const file = context.manifestPaths.get(owner);

    return createFinding({
      ruleId: 'DEP-CYCLE-001',
      severity: 'MEDIUM',
      // The cycle itself is a fact about the graph. What is uncertain is
      // whether it causes a problem at runtime, which is reflected in the
      // wording rather than in a lowered confidence.
      confidence: 0.9,
      title: 'Dependency cycle detected',
      summary: `The resources ${cycle.join(', ')} form a dependency cycle (${rendered}). Load order within a cycle is not deterministic.`,
      recommendation:
        'Break the cycle by extracting the shared code into a third resource, or by making one direction an optional runtime lookup.',
      evidence: cycle.map((name, index) => ({
        kind: 'RELATIONSHIP' as const,
        description: `${name} depends on ${cycle[(index + 1) % cycle.length] ?? ''}.`,
        ...(context.manifestPaths.has(name) ? { location: { file: context.manifestPaths.get(name) ?? '' } } : {}),
        metadata: { from: name, to: cycle[(index + 1) % cycle.length] ?? '' },
      })),
      resource: owner,
      ...(file === undefined ? {} : { file }),
      timestamp,
      discriminator: cycle.join('>'),
      metadata: { cycleLength: cycle.length, cycle: cycle.join(' -> ') },
    });
  });
}
