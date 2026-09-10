import { describe, expect, it } from 'vitest';
import { extractCalls } from './calls.js';
import { lexLua } from './lexer.js';

function callsOf(source: string): ReturnType<typeof extractCalls> {
  return extractCalls(lexLua(source).tokens);
}

describe('call extraction', () => {
  it('reads a plain call and its literal arguments', () => {
    const [call] = callsOf("TriggerServerEvent('shop:buy', 42)");
    expect(call).toMatchObject({ name: 'TriggerServerEvent', method: 'TriggerServerEvent', line: 1 });
    expect(call?.stringArguments).toEqual(['shop:buy']);
    expect(call?.numberArguments).toEqual([42]);
  });

  it('reads dotted and colon-qualified names', () => {
    expect(callsOf('Citizen.Wait(0)')[0]?.name).toBe('Citizen.Wait');
    expect(callsOf('MySQL.Async.fetchAll("SELECT 1")')[0]?.name).toBe('MySQL.Async.fetchAll');
    expect(callsOf('exports.oxmysql:execute("SELECT 1")')[0]?.name).toBe('exports.oxmysql:execute');
  });

  it('reads Lua call sugar without parentheses', () => {
    const [call] = callsOf("require 'module'");
    expect(call?.name).toBe('require');
    expect(call?.stringArguments).toEqual(['module']);
    expect(call?.parenthesised).toBe(false);
  });

  it('marks non-literal arguments instead of guessing their value', () => {
    const [call] = callsOf('TriggerServerEvent(eventName, coords)');
    expect(call?.stringArguments).toEqual([]);
    expect(call?.hasNonLiteralArguments).toBe(true);
  });

  it('does not treat a nested call argument as an argument of the outer call', () => {
    const calls = callsOf("outer('a', inner('b'))");
    expect(calls[0]?.name).toBe('outer');
    expect(calls[0]?.stringArguments).toEqual(['a']);
    expect(calls.some((call) => call.name === 'inner')).toBe(true);
  });

  it('does not report a qualified name segment as its own call', () => {
    const names = callsOf('Citizen.Wait(0)').map((call) => call.name);
    expect(names).toEqual(['Citizen.Wait']);
  });

  it('records negative numeric arguments, which address every client', () => {
    const [call] = callsOf("TriggerClientEvent('x', -1, payload)");
    expect(call?.numberArguments).toContain(-1);
  });

  it('finds every call in a realistic snippet', () => {
    const source = [
      'CreateThread(function()',
      '  while true do',
      '    Wait(500)',
      "    TriggerServerEvent('tick')",
      '  end',
      'end)',
    ].join('\n');
    expect(callsOf(source).map((call) => call.name)).toEqual(['CreateThread', 'Wait', 'TriggerServerEvent']);
  });
});
