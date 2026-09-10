/**
 * Event graph.
 *
 * Records which resources register which events and which resources trigger
 * them, so a reviewer can see the shape of a server's event traffic and follow
 * a chain across resource boundaries.
 *
 * The graph is reported as data rather than as findings. An event registered in
 * one resource and triggered from another is normal architecture, not a defect;
 * what makes it interesting is being able to see it at all.
 */

import type { EventFact, ScriptAnalysis } from '../lua/script.js';

export interface EventEndpoint {
  readonly resource: string;
  /** Server-relative POSIX path. */
  readonly file: string;
  readonly line: number;
  readonly call: string;
  readonly side: ScriptAnalysis['side'];
}

export interface EventNode {
  readonly event: string;
  readonly registrations: readonly EventEndpoint[];
  readonly triggers: readonly EventEndpoint[];
  /** True when at least one trigger sends to every connected client. */
  readonly broadcast: boolean;
  /** True when the event crosses the client/server boundary. */
  readonly network: boolean;
}

export interface EventGraph {
  readonly events: readonly EventNode[];
  /** Events triggered somewhere but registered nowhere in the scanned server. */
  readonly triggeredButNotRegistered: readonly string[];
  /** Events registered somewhere but never triggered in the scanned server. */
  readonly registeredButNotTriggered: readonly string[];
  /** Usages whose event name was computed at runtime and could not be read. */
  readonly dynamicUsageCount: number;
}

export function buildEventGraph(scripts: readonly ScriptAnalysis[]): EventGraph {
  const registrations = new Map<string, EventEndpoint[]>();
  const triggers = new Map<string, EventEndpoint[]>();
  const broadcasts = new Set<string>();
  const network = new Set<string>();
  let dynamicUsageCount = 0;

  const endpoint = (script: ScriptAnalysis, fact: EventFact): EventEndpoint => ({
    resource: script.resource,
    file: script.filePath,
    line: fact.line,
    call: fact.call,
    side: script.side,
  });

  for (const script of scripts) {
    for (const fact of script.events) {
      if (fact.event === undefined) {
        dynamicUsageCount += 1;
        continue;
      }

      const target = fact.kind === 'REGISTRATION' ? registrations : triggers;
      const list = target.get(fact.event) ?? [];
      list.push(endpoint(script, fact));
      target.set(fact.event, list);

      if (fact.broadcast === true) broadcasts.add(fact.event);
      if (fact.direction === 'to-server' || fact.direction === 'to-client') network.add(fact.event);
    }
  }

  const names = [...new Set([...registrations.keys(), ...triggers.keys()])].sort((a, b) => a.localeCompare(b));

  const events: EventNode[] = names.map((event) => ({
    event,
    registrations: registrations.get(event) ?? [],
    triggers: triggers.get(event) ?? [],
    broadcast: broadcasts.has(event),
    network: network.has(event),
  }));

  return {
    events,
    triggeredButNotRegistered: names.filter(
      (event) => (triggers.get(event)?.length ?? 0) > 0 && (registrations.get(event)?.length ?? 0) === 0,
    ),
    registeredButNotTriggered: names.filter(
      (event) => (registrations.get(event)?.length ?? 0) > 0 && (triggers.get(event)?.length ?? 0) === 0,
    ),
    dynamicUsageCount,
  };
}

/** Events a resource registers or triggers, for the resource detail view. */
export function eventsForResource(graph: EventGraph, resource: string): EventNode[] {
  return graph.events.filter(
    (event) =>
      event.registrations.some((entry) => entry.resource === resource) ||
      event.triggers.some((entry) => entry.resource === resource),
  );
}
