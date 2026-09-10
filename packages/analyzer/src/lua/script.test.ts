import { describe, expect, it } from 'vitest';
import { analyzeScript, isDatabaseCall } from './script.js';

function analyze(source: string): ReturnType<typeof analyzeScript> {
  return analyzeScript(source, { filePath: 'resources/sf_test/client.lua', resource: 'sf_test', side: 'client' });
}

describe('script analysis', () => {
  it('identifies a continuous loop that never yields', () => {
    const analysis = analyze(['CreateThread(function()', '  while true do', '    work()', '  end', 'end)'].join('\n'));
    expect(analysis.loops).toHaveLength(1);
    expect(analysis.loops[0]).toMatchObject({ continuous: true, yields: false, insideThread: true });
  });

  it('identifies a loop that yields, including Wait(0)', () => {
    const analysis = analyze(['while true do', '  Wait(0)', 'end'].join('\n'));
    expect(analysis.loops[0]).toMatchObject({ continuous: true, yields: true, waitMs: 0 });
  });

  it('records the shortest literal wait interval in a body', () => {
    const analysis = analyze(['while true do', '  Wait(500)', '  Wait(100)', 'end'].join('\n'));
    expect(analysis.loops[0]?.waitMs).toBe(100);
  });

  it('recognises Citizen.Wait as a yield', () => {
    expect(analyze('while true do Citizen.Wait(0) end').loops[0]?.yields).toBe(true);
  });

  it('does not treat a bounded for loop as continuous', () => {
    expect(analyze('for i = 1, 10 do work() end').loops[0]?.continuous).toBe(false);
  });

  it('counts calls it cannot follow, which is what lowers rule confidence', () => {
    const analysis = analyze('while true do someUserFunction() end');
    expect(analysis.loops[0]?.opaqueCallCount).toBe(1);
    expect(analyze('while true do print("x") end').loops[0]?.opaqueCallCount).toBe(0);
  });

  it('records event registrations and triggers with their names', () => {
    const analysis = analyze(
      ["RegisterNetEvent('shop:open', function() end)", "TriggerServerEvent('shop:buy', 1)"].join('\n'),
    );
    expect(analysis.events.map((event) => `${event.kind}:${event.event ?? '?'}`)).toEqual([
      'REGISTRATION:shop:open',
      'TRIGGER:shop:buy',
    ]);
    expect(analysis.events[1]?.direction).toBe('to-server');
  });

  it('marks a trigger that addresses every client as a broadcast', () => {
    const analysis = analyze("TriggerClientEvent('notify', -1, 'hello')");
    expect(analysis.events[0]).toMatchObject({ direction: 'to-client', broadcast: true });
  });

  it('does not invent an event name that was computed at runtime', () => {
    const analysis = analyze('TriggerServerEvent(eventName, payload)');
    expect(analysis.events[0]?.event).toBeUndefined();
  });

  it('links an event trigger to the loop that contains it', () => {
    const analysis = analyze(['while true do', '  Wait(0)', "  TriggerServerEvent('tick')", 'end'].join('\n'));
    expect(analysis.events[0]?.loop).toBeDefined();
    expect(analysis.events[0]?.loop?.waitMs).toBe(0);
  });

  it('recognises database calls across the common frameworks', () => {
    expect(isDatabaseCall('MySQL.query')).toBe(true);
    expect(isDatabaseCall('MySQL.Async.fetchAll')).toBe(true);
    expect(isDatabaseCall('exports.oxmysql:execute')).toBe(true);
    expect(isDatabaseCall('TriggerEvent')).toBe(false);
  });

  it('classifies a query statement', () => {
    const analysis = analyze("MySQL.query('SELECT * FROM users')");
    expect(analysis.queries[0]).toMatchObject({
      isSelect: true,
      selectsEveryColumn: true,
      hasWhere: false,
      hasLimit: false,
      concatenated: false,
    });
  });

  it('detects a statement assembled by concatenation', () => {
    const analysis = analyze("MySQL.query('SELECT id FROM users WHERE name = ' .. name)");
    expect(analysis.queries[0]?.concatenated).toBe(true);
  });

  it('links a query to the loop that contains it', () => {
    const analysis = analyze(['for i = 1, 100 do', "  MySQL.query('SELECT 1')", 'end'].join('\n'));
    expect(analysis.queries[0]?.loop).toBeDefined();
  });

  it('reports unbalanced source rather than producing confident nonsense', () => {
    expect(analyze('while true do\n  work()').unbalanced).toBe(true);
  });

  it('never throws on hostile source', () => {
    for (const source of ['', 'end end end', "while true do '", '('.repeat(2000), 'a'.repeat(20_000)]) {
      expect(() => analyze(source), JSON.stringify(source.slice(0, 8))).not.toThrow();
    }
  });
});
