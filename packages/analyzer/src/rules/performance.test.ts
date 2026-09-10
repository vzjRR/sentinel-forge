import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@sentinel-forge/core';
import { analyzeScript } from '../lua/script.js';
import { analyzeEventFrequency, analyzeLoops, analyzePerformance, analyzeQueries } from './performance.js';

const clock = createFixedClock(new Date('2026-01-01T00:00:00.000Z'));

function run(source: string, side: 'client' | 'server' = 'client'): ReturnType<typeof analyzePerformance> {
  const script = analyzeScript(source, { filePath: 'resources/sf_test/main.lua', resource: 'sf_test', side });
  return analyzePerformance({ script, clock });
}

function loops(source: string): ReturnType<typeof analyzeLoops> {
  const script = analyzeScript(source, { filePath: 'resources/sf_test/main.lua', resource: 'sf_test', side: 'client' });
  return analyzeLoops({ script, clock });
}

describe('PERF-LOOP-001', () => {
  it('reports a continuous loop with no yield', () => {
    const findings = loops(['CreateThread(function()', '  while true do', '    work()', '  end', 'end)'].join('\n'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'PERF-LOOP-001', severity: 'HIGH', line: 2 });
  });

  it('does NOT report Wait(0), which is a legitimate per-frame pattern', () => {
    // The product specification calls this out explicitly, and the
    // performance-smell fixture carries it as a false-positive control.
    expect(loops(['while true do', '  Wait(0)', '  DrawRect(0.5, 0.5, 0.1, 0.1)', 'end'].join('\n'))).toEqual([]);
  });

  it('does not report a bounded for loop', () => {
    expect(loops('for i = 1, 1000 do heavyWork() end')).toEqual([]);
  });

  it('does not report a while loop with a real condition', () => {
    expect(loops('while running do work() end')).toEqual([]);
  });

  it('recognises Citizen.Wait as a yield', () => {
    expect(loops('while true do Citizen.Wait(100) end')).toEqual([]);
  });

  it('lowers confidence when the body calls something it cannot follow', () => {
    const opaque = loops('while true do someHelper() end')[0];
    const clear = loops('while true do print("x") end')[0];
    expect(opaque?.confidence).toBeLessThan(clear?.confidence ?? 1);
    expect(opaque?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('lowers confidence further when the source did not balance', () => {
    const finding = loops('while true do print("x")')[0];
    expect(finding?.confidence).toBeLessThanOrEqual(0.5);
  });

  it('raises severity when the loop is a thread main loop', () => {
    const inThread = loops('CreateThread(function() while true do print("x") end end)')[0];
    const bare = loops('while true do print("x") end')[0];
    expect(inThread?.severity).toBe('HIGH');
    expect(bare?.severity).toBe('MEDIUM');
  });
});

describe('PERF-EVENT-001', () => {
  const events = (source: string): ReturnType<typeof analyzeEventFrequency> => {
    const script = analyzeScript(source, { filePath: 'resources/sf_test/main.lua', resource: 'sf_test', side: 'client' });
    return analyzeEventFrequency({ script, clock });
  };

  it('reports a network trigger in a per-frame loop', () => {
    const findings = events(['while true do', '  Wait(0)', "  TriggerServerEvent('tick')", 'end'].join('\n'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'PERF-EVENT-001', severity: 'MEDIUM' });
    expect(findings[0]?.summary).toContain('every 0 ms');
  });

  it('reports a network trigger in a loop with no wait at all', () => {
    expect(events(["while true do TriggerServerEvent('tick') end"].join('\n'))).toHaveLength(1);
  });

  it('does not report a trigger in a loop with a sensible interval', () => {
    expect(events(['while true do', '  Wait(1000)', "  TriggerServerEvent('tick')", 'end'].join('\n'))).toEqual([]);
  });

  it('does not report a trigger outside any loop', () => {
    expect(events("TriggerServerEvent('once')")).toEqual([]);
  });

  it('does not report a local TriggerEvent, which sends nothing over the network', () => {
    expect(events(['while true do', '  Wait(0)', "  TriggerEvent('local:tick')", 'end'].join('\n'))).toEqual([]);
  });

  it('does not report a bounded loop', () => {
    expect(events("for i = 1, 5 do TriggerServerEvent('tick') end")).toEqual([]);
  });
});

describe('PERF-QUERY-001', () => {
  const queries = (source: string): ReturnType<typeof analyzeQueries> => {
    const script = analyzeScript(source, { filePath: 'resources/sf_test/server.lua', resource: 'sf_test', side: 'server' });
    return analyzeQueries({ script, clock });
  };

  it('reports a query executed once per iteration', () => {
    const findings = queries(['for i = 1, 100 do', "  MySQL.query('SELECT id FROM t WHERE x = 1')", 'end'].join('\n'));
    expect(findings.some((finding) => finding.title === 'Database query inside a loop')).toBe(true);
  });

  it('treats a query in a continuous loop as more severe than one in a bounded loop', () => {
    const bounded = queries("for i = 1, 10 do MySQL.query('SELECT 1 FROM t WHERE x = 1') end")[0];
    const continuous = queries("while true do MySQL.query('SELECT 1 FROM t WHERE x = 1') end")[0];
    expect(bounded?.severity).toBe('MEDIUM');
    expect(continuous?.severity).toBe('HIGH');
  });

  it('reports a SELECT with no WHERE and no LIMIT', () => {
    const findings = queries("MySQL.query('SELECT id FROM players')");
    expect(findings[0]).toMatchObject({ title: 'SELECT with no WHERE or LIMIT clause', severity: 'LOW' });
  });

  it('does not report a bounded SELECT', () => {
    expect(queries("MySQL.query('SELECT id FROM players WHERE identifier = ?', { id })")).toEqual([]);
    expect(queries("MySQL.query('SELECT id FROM players LIMIT 1')")).toEqual([]);
  });

  it('reports SELECT * as an observation rather than a defect', () => {
    const findings = queries("MySQL.query('SELECT * FROM players WHERE id = ?', { id })");
    expect(findings[0]).toMatchObject({ severity: 'INFO', title: 'SELECT retrieves every column' });
  });

  it('does not report a parameterized query as a problem', () => {
    expect(queries("MySQL.query('SELECT name FROM players WHERE identifier = ?', { identifier })")).toEqual([]);
  });

  it('does not report a non-database call that happens to take a string', () => {
    expect(queries("print('SELECT * FROM players')")).toEqual([]);
  });
});

describe('performance rules as a set', () => {
  it('report nothing on ordinary, correct code', () => {
    const source = [
      'CreateThread(function()',
      '  while true do',
      '    Wait(5000)',
      '    local players = GetActivePlayers()',
      '    for _, player in ipairs(players) do',
      '      updateBlip(player)',
      '    end',
      '  end',
      'end)',
      '',
      "RegisterNetEvent('sf:sync', function(payload)",
      "  MySQL.query('SELECT id FROM players WHERE identifier = ? LIMIT 1', { payload.id })",
      'end)',
    ].join('\n');
    expect(run(source)).toEqual([]);
  });

  it('produce stable ids across runs', () => {
    const source = 'CreateThread(function() while true do work() end end)';
    expect(run(source).map((finding) => finding.id)).toEqual(run(source).map((finding) => finding.id));
  });
});
