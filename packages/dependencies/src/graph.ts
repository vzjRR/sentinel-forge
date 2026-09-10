/**
 * Resource dependency graph.
 *
 * Edges come from two places:
 *
 *   - *declared* dependencies, from the manifest's `dependency`/`dependencies`
 *     directive;
 *   - *discovered* dependencies, inferred from `@other_resource/file.lua`
 *     references in script and file lists, which require the other resource to
 *     be present even though nothing declares it.
 *
 * Resolution accounts for `provide`: a resource declaring `provide 'mysql-async'`
 * satisfies a dependency on `mysql-async`. Ignoring that would report a missing
 * dependency for every server using a drop-in replacement.
 *
 * Reference: https://docs.fivem.net/docs/scripting-reference/resource-manifest/
 */

import type { DependencyEdge, DependencyEdgeKind } from '@sentinel-forge/shared';

export interface GraphResourceInput {
  readonly name: string;
  /** Server-relative path of the manifest, for evidence. */
  readonly manifestPath?: string;
  readonly declaredDependencies: readonly {
    readonly name: string;
    readonly line: number;
    readonly isRuntimeConstraint: boolean;
  }[];
  /** Resource names referenced through `@resource/path` entries. */
  readonly referencedResources: readonly { readonly name: string; readonly line: number }[];
  /** Names this resource declares it provides. */
  readonly provides: readonly string[];
}

export interface DependencyGraphEdge extends DependencyEdge {
  /** Line in the declaring manifest, when the edge came from a declaration. */
  readonly line?: number;
}

export interface DependencyGraph {
  readonly nodes: readonly string[];
  readonly edges: readonly DependencyGraphEdge[];
  /** Edges whose target could not be resolved to a resource or a provided name. */
  readonly unresolved: readonly DependencyGraphEdge[];
  /** Cycles as ordered name lists; the first name is repeated implicitly. */
  readonly cycles: readonly (readonly string[])[];
  /** Runtime constraints (`/server:4500`, `/onesync`) seen per resource. */
  readonly runtimeConstraints: readonly { readonly resource: string; readonly constraint: string; readonly line: number }[];
  /** Map of provided name to the resource that provides it. */
  readonly providers: ReadonlyMap<string, string>;
}

export function buildDependencyGraph(resources: readonly GraphResourceInput[]): DependencyGraph {
  const nodes = resources.map((resource) => resource.name).sort((a, b) => a.localeCompare(b));
  const present = new Set(nodes);

  const providers = new Map<string, string>();
  for (const resource of resources) {
    for (const provided of resource.provides) {
      // First declaration wins, and a real resource always beats a provided
      // alias of the same name.
      if (!providers.has(provided)) providers.set(provided, resource.name);
    }
  }

  const edges: DependencyGraphEdge[] = [];
  const runtimeConstraints: { resource: string; constraint: string; line: number }[] = [];
  const seen = new Set<string>();

  const addEdge = (from: string, to: string, kind: DependencyEdgeKind, line: number, declaredIn?: string): void => {
    const key = `${from}|${to}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      from,
      to,
      kind,
      resolved: present.has(to) || providers.has(to),
      line,
      ...(declaredIn === undefined ? {} : { declaredIn }),
    });
  };

  for (const resource of resources) {
    for (const dependency of resource.declaredDependencies) {
      if (dependency.isRuntimeConstraint) {
        runtimeConstraints.push({ resource: resource.name, constraint: dependency.name, line: dependency.line });
        continue;
      }
      addEdge(resource.name, dependency.name, 'DECLARED', dependency.line, resource.manifestPath);
    }

    for (const reference of resource.referencedResources) {
      if (reference.name === resource.name) continue;
      addEdge(resource.name, reference.name, 'DISCOVERED', reference.line, resource.manifestPath);
    }
  }

  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));

  return {
    nodes,
    edges,
    unresolved: edges.filter((edge) => !edge.resolved),
    cycles: findCycles(nodes, edges, providers),
    runtimeConstraints,
    providers,
  };
}

/**
 * Finds cycles among resolved edges using an iterative depth-first search.
 *
 * Iterative rather than recursive because the input is untrusted: a deep or
 * pathological graph must not overflow the stack and take the scan with it.
 *
 * Each cycle is reported once, in a canonical rotation (starting at its
 * alphabetically first member) so that two runs produce identical output.
 */
function findCycles(
  nodes: readonly string[],
  edges: readonly DependencyGraphEdge[],
  providers: ReadonlyMap<string, string>,
): (readonly string[])[] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);

  for (const edge of edges) {
    if (!edge.resolved) continue;
    // Resolve a provided alias to the resource that actually provides it, so a
    // cycle through `provide` is still detected.
    const target = adjacency.has(edge.to) ? edge.to : providers.get(edge.to);
    if (target === undefined) continue;
    adjacency.get(edge.from)?.push(target);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>(nodes.map((node) => [node, WHITE]));
  const found = new Map<string, readonly string[]>();

  for (const start of nodes) {
    if (colour.get(start) !== WHITE) continue;

    const stack: { node: string; neighbours: string[]; index: number }[] = [
      { node: start, neighbours: adjacency.get(start) ?? [], index: 0 },
    ];
    const path: string[] = [start];
    colour.set(start, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;

      if (frame.index >= frame.neighbours.length) {
        colour.set(frame.node, BLACK);
        stack.pop();
        path.pop();
        continue;
      }

      const neighbour = frame.neighbours[frame.index];
      frame.index += 1;
      if (neighbour === undefined) continue;

      const neighbourColour = colour.get(neighbour) ?? WHITE;

      if (neighbourColour === GREY) {
        const cycleStart = path.indexOf(neighbour);
        if (cycleStart === -1) continue;
        const cycle = path.slice(cycleStart);
        const canonical = canonicalRotation(cycle);
        found.set(canonical.join('>'), canonical);
        continue;
      }

      if (neighbourColour === WHITE) {
        colour.set(neighbour, GREY);
        path.push(neighbour);
        stack.push({ node: neighbour, neighbours: adjacency.get(neighbour) ?? [], index: 0 });
      }
    }
  }

  return [...found.values()].sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}

/** Rotates a cycle so it starts at its alphabetically first member. */
function canonicalRotation(cycle: readonly string[]): string[] {
  let smallest = 0;
  for (let index = 1; index < cycle.length; index += 1) {
    if ((cycle[index] ?? '').localeCompare(cycle[smallest] ?? '') < 0) smallest = index;
  }
  return [...cycle.slice(smallest), ...cycle.slice(0, smallest)];
}

/** Resources that depend on `name`, directly. */
export function dependentsOf(graph: DependencyGraph, name: string): string[] {
  return graph.edges.filter((edge) => edge.to === name).map((edge) => edge.from);
}

/** Resources `name` depends on, directly. */
export function dependenciesOf(graph: DependencyGraph, name: string): string[] {
  return graph.edges.filter((edge) => edge.from === name).map((edge) => edge.to);
}
