import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@sentinel-forge/core';
import { buildDependencyGraph, type GraphResourceInput } from './graph.js';
import { analyzeDependencies } from './rules.js';

const clock = createFixedClock(new Date('2026-01-01T00:00:00.000Z'));

function node(name: string, declared: string[] = [], referenced: string[] = []): GraphResourceInput {
  return {
    name,
    manifestPath: `resources/${name}/fxmanifest.lua`,
    declaredDependencies: declared.map((dependency, index) => ({
      name: dependency,
      line: index + 5,
      isRuntimeConstraint: false,
    })),
    referencedResources: referenced.map((reference, index) => ({ name: reference, line: index + 9 })),
    provides: [],
  };
}

function analyze(resources: GraphResourceInput[], platform: string[] = []): ReturnType<typeof analyzeDependencies> {
  const graph = buildDependencyGraph(resources);
  return analyzeDependencies({
    graph,
    platformResources: new Set(platform),
    manifestPaths: new Map(resources.map((resource) => [resource.name, resource.manifestPath ?? ''])),
    clock,
  });
}

describe('DEP-MISSING-001', () => {
  it('reports nothing when every dependency resolves', () => {
    expect(analyze([node('sf_hud', ['sf_core']), node('sf_core')])).toEqual([]);
  });

  it('reports a declared dependency that was not found, pointing at the declaration', () => {
    const findings = analyze([node('sf_shop', ['sf_inventory'])]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'DEP-MISSING-001',
      severity: 'HIGH',
      resource: 'sf_shop',
      file: 'resources/sf_shop/fxmanifest.lua',
      line: 5,
    });
    expect(findings[0]?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reports a discovered @resource reference slightly less confidently than a declaration', () => {
    const declared = analyze([node('sf_a', ['missing'])])[0];
    const discovered = analyze([node('sf_b', [], ['missing'])])[0];
    expect(discovered?.title).toBe('Referenced resource was not found');
    expect(discovered?.confidence).toBeLessThan(declared?.confidence ?? 1);
  });

  it('records a platform-provided dependency at INFO instead of raising it', () => {
    const findings = analyze([node('sf_core', ['mapmanager'])], ['mapmanager']);
    expect(findings[0]).toMatchObject({ severity: 'INFO' });
    expect(findings[0]?.confidence).toBeLessThanOrEqual(0.25);
    expect(findings[0]?.recommendation).toContain('No action needed');
  });

  it('carries the dependency name in metadata for downstream consumers', () => {
    const findings = analyze([node('sf_shop', ['sf_inventory'])]);
    expect(findings[0]?.metadata).toMatchObject({ dependency: 'sf_inventory', kind: 'DECLARED' });
  });
});

describe('DEP-CYCLE-001', () => {
  it('reports nothing for an acyclic graph', () => {
    const findings = analyze([node('sf_a', ['sf_b']), node('sf_b', ['sf_c']), node('sf_c')]);
    expect(findings.filter((finding) => finding.ruleId === 'DEP-CYCLE-001')).toEqual([]);
  });

  it('reports a cycle with one evidence record per edge', () => {
    const findings = analyze([node('sf_a', ['sf_b']), node('sf_b', ['sf_a'])]).filter(
      (finding) => finding.ruleId === 'DEP-CYCLE-001',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'MEDIUM' });
    expect(findings[0]?.evidence).toHaveLength(2);
    expect(findings[0]?.summary).toContain('sf_a -> sf_b -> sf_a');
  });

  it('describes load order as non-deterministic rather than as a guaranteed failure', () => {
    const findings = analyze([node('sf_a', ['sf_b']), node('sf_b', ['sf_a'])]);
    const cycle = findings.find((finding) => finding.ruleId === 'DEP-CYCLE-001');
    expect(cycle?.summary).toContain('not deterministic');
    expect(cycle?.summary).not.toMatch(/will fail|guaranteed|always breaks/i);
  });

  it('produces a stable finding id across runs', () => {
    const first = analyze([node('sf_a', ['sf_b']), node('sf_b', ['sf_a'])]);
    const second = analyze([node('sf_b', ['sf_a']), node('sf_a', ['sf_b'])]);
    expect(first.map((finding) => finding.id).sort()).toEqual(second.map((finding) => finding.id).sort());
  });
});
