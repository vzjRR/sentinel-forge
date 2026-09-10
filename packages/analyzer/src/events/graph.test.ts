import { describe, expect, it } from 'vitest';
import { analyzeScript, type ScriptAnalysis } from '../lua/script.js';
import { buildEventGraph, eventsForResource } from './graph.js';

function script(resource: string, source: string, side: ScriptAnalysis['side'] = 'client'): ScriptAnalysis {
  return analyzeScript(source, { filePath: `resources/${resource}/main.lua`, resource, side });
}

describe('event graph', () => {
  it('links a registration in one resource to a trigger in another', () => {
    const graph = buildEventGraph([
      script('sf_core', "RegisterNetEvent('sf:sync', function() end)", 'server'),
      script('sf_hud', "TriggerServerEvent('sf:sync')"),
    ]);

    expect(graph.events).toHaveLength(1);
    expect(graph.events[0]?.registrations[0]?.resource).toBe('sf_core');
    expect(graph.events[0]?.triggers[0]?.resource).toBe('sf_hud');
    expect(graph.events[0]?.network).toBe(true);
  });

  it('reports an event triggered but never registered', () => {
    const graph = buildEventGraph([script('sf_hud', "TriggerServerEvent('sf:missing')")]);
    expect(graph.triggeredButNotRegistered).toEqual(['sf:missing']);
    expect(graph.registeredButNotTriggered).toEqual([]);
  });

  it('reports an event registered but never triggered', () => {
    const graph = buildEventGraph([script('sf_core', "RegisterNetEvent('sf:unused', function() end)", 'server')]);
    expect(graph.registeredButNotTriggered).toEqual(['sf:unused']);
  });

  it('marks a broadcast to every client', () => {
    const graph = buildEventGraph([script('sf_core', "TriggerClientEvent('sf:notify', -1, 'hello')", 'server')]);
    expect(graph.events[0]?.broadcast).toBe(true);
  });

  it('counts usages whose event name was computed, without inventing a name', () => {
    const graph = buildEventGraph([script('sf_core', 'TriggerServerEvent(name)')]);
    expect(graph.dynamicUsageCount).toBe(1);
    expect(graph.events).toEqual([]);
  });

  it('orders events by name so two runs produce identical output', () => {
    const scripts = [script('a', "TriggerServerEvent('z')"), script('b', "TriggerServerEvent('a')")];
    expect(buildEventGraph(scripts).events.map((event) => event.event)).toEqual(['a', 'z']);
    expect(buildEventGraph([...scripts].reverse()).events.map((event) => event.event)).toEqual(['a', 'z']);
  });

  it('answers which events a resource participates in', () => {
    const graph = buildEventGraph([
      script('sf_core', "RegisterNetEvent('sf:a', function() end)\nTriggerServerEvent('sf:b')", 'server'),
      script('sf_other', "TriggerServerEvent('sf:c')"),
    ]);
    expect(eventsForResource(graph, 'sf_core').map((event) => event.event)).toEqual(['sf:a', 'sf:b']);
  });

  it('de-duplicates a resource that triggers the same event repeatedly', () => {
    const graph = buildEventGraph([
      script('sf_hud', ["TriggerServerEvent('sf:tick')", "TriggerServerEvent('sf:tick')"].join('\n')),
    ]);
    expect(graph.events[0]?.triggers).toHaveLength(2);
    expect(new Set(graph.events[0]?.triggers.map((entry) => entry.resource)).size).toBe(1);
  });
});
