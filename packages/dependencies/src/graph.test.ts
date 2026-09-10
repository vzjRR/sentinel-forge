import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, dependenciesOf, dependentsOf, type GraphResourceInput } from './graph.js';

function node(
  name: string,
  declared: string[] = [],
  options: { referenced?: string[]; provides?: string[]; constraints?: string[] } = {},
): GraphResourceInput {
  return {
    name,
    manifestPath: `resources/${name}/fxmanifest.lua`,
    declaredDependencies: [
      ...declared.map((dependency, index) => ({ name: dependency, line: index + 1, isRuntimeConstraint: false })),
      ...(options.constraints ?? []).map((constraint, index) => ({
        name: constraint,
        line: index + 10,
        isRuntimeConstraint: true,
      })),
    ],
    referencedResources: (options.referenced ?? []).map((reference, index) => ({ name: reference, line: index + 20 })),
    provides: options.provides ?? [],
  };
}

describe('dependency graph', () => {
  it('resolves an edge to a resource that exists', () => {
    const graph = buildDependencyGraph([node('sf_hud', ['sf_core']), node('sf_core')]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: 'sf_hud', to: 'sf_core', kind: 'DECLARED', resolved: true });
    expect(graph.unresolved).toEqual([]);
  });

  it('marks an edge to a resource that does not exist as unresolved', () => {
    const graph = buildDependencyGraph([node('sf_shop', ['sf_inventory'])]);
    expect(graph.unresolved).toHaveLength(1);
    expect(graph.unresolved[0]?.to).toBe('sf_inventory');
  });

  it('records the declaring line, so a finding can point at it', () => {
    const graph = buildDependencyGraph([node('sf_shop', ['sf_inventory'])]);
    expect(graph.edges[0]?.line).toBe(1);
    expect(graph.edges[0]?.declaredIn).toBe('resources/sf_shop/fxmanifest.lua');
  });

  it('discovers a dependency from an @resource reference', () => {
    const graph = buildDependencyGraph([node('sf_hud', [], { referenced: ['ox_lib'] }), node('ox_lib')]);
    expect(graph.edges[0]).toMatchObject({ kind: 'DISCOVERED', to: 'ox_lib', resolved: true });
  });

  it('resolves a dependency satisfied by another resource declaring provide', () => {
    const graph = buildDependencyGraph([
      node('sf_shop', ['mysql-async']),
      node('oxmysql', [], { provides: ['mysql-async'] }),
    ]);
    expect(graph.unresolved).toEqual([]);
    expect(graph.providers.get('mysql-async')).toBe('oxmysql');
  });

  it('keeps runtime constraints out of the graph entirely', () => {
    // `/server:5104` and `/onesync` are runtime requirements, not resources.
    const graph = buildDependencyGraph([node('sf_core', [], { constraints: ['/server:5104', '/onesync'] })]);
    expect(graph.edges).toEqual([]);
    expect(graph.unresolved).toEqual([]);
    expect(graph.runtimeConstraints.map((entry) => entry.constraint)).toEqual(['/server:5104', '/onesync']);
  });

  it('detects a two-resource cycle', () => {
    const graph = buildDependencyGraph([node('sf_a', ['sf_b']), node('sf_b', ['sf_a'])]);
    expect(graph.cycles).toEqual([['sf_a', 'sf_b']]);
  });

  it('detects a longer cycle and reports it once, canonically rotated', () => {
    const graph = buildDependencyGraph([node('sf_b', ['sf_c']), node('sf_c', ['sf_a']), node('sf_a', ['sf_b'])]);
    expect(graph.cycles).toEqual([['sf_a', 'sf_b', 'sf_c']]);
  });

  it('detects a self-dependency as a cycle', () => {
    const graph = buildDependencyGraph([node('sf_a', ['sf_a'])]);
    expect(graph.cycles).toEqual([['sf_a']]);
  });

  it('reports no cycle for a diamond, which is not one', () => {
    const graph = buildDependencyGraph([
      node('sf_top', ['sf_left', 'sf_right']),
      node('sf_left', ['sf_base']),
      node('sf_right', ['sf_base']),
      node('sf_base'),
    ]);
    expect(graph.cycles).toEqual([]);
  });

  it('finds a cycle that runs through a provided alias', () => {
    const graph = buildDependencyGraph([
      node('sf_a', ['alias']),
      node('sf_b', ['sf_a'], { provides: ['alias'] }),
    ]);
    expect(graph.cycles).toEqual([['sf_a', 'sf_b']]);
  });

  it('terminates on a deep chain without recursing, since input is untrusted', () => {
    const chain = Array.from({ length: 5000 }, (_value, index) =>
      node(`sf_${String(index)}`, index === 4999 ? [] : [`sf_${String(index + 1)}`]),
    );
    expect(() => buildDependencyGraph(chain)).not.toThrow();
    expect(buildDependencyGraph(chain).cycles).toEqual([]);
  });

  it('produces identical output regardless of input order', () => {
    const resources = [node('sf_c', ['sf_a']), node('sf_a', ['sf_b']), node('sf_b')];
    const forward = buildDependencyGraph(resources);
    const reversed = buildDependencyGraph([...resources].reverse());
    expect(JSON.stringify(forward.edges)).toBe(JSON.stringify(reversed.edges));
    expect(forward.nodes).toEqual(reversed.nodes);
  });

  it('de-duplicates a dependency declared twice', () => {
    const graph = buildDependencyGraph([node('sf_a', ['sf_b', 'sf_b']), node('sf_b')]);
    expect(graph.edges).toHaveLength(1);
  });

  it('answers dependency and dependent queries', () => {
    const graph = buildDependencyGraph([node('sf_a', ['sf_b']), node('sf_c', ['sf_b']), node('sf_b')]);
    expect(dependenciesOf(graph, 'sf_a')).toEqual(['sf_b']);
    expect(dependentsOf(graph, 'sf_b').sort()).toEqual(['sf_a', 'sf_c']);
  });
});
