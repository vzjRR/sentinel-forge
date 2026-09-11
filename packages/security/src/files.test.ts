import { describe, expect, it } from 'vitest';
import { findSuspiciousFiles } from './files.js';

function files(...paths: string[]): { path: string; size: number }[] {
  return paths.map((path) => ({ path, size: 1024 }));
}

describe('suspicious file detection', () => {
  it('reports nothing for an ordinary resource', () => {
    expect(findSuspiciousFiles(files('fxmanifest.lua', 'client.lua', 'server.lua', 'html/index.html', 'config.json'))).toEqual([]);
  });

  it('reports an executable with high confidence', () => {
    const found = findSuspiciousFiles(files('helper.exe'));
    expect(found[0]).toMatchObject({ kind: 'EXECUTABLE', confidence: 0.9 });
  });

  it('reports a host script', () => {
    expect(findSuspiciousFiles(files('install.ps1'))[0]?.kind).toBe('HOST_SCRIPT');
    expect(findSuspiciousFiles(files('run.sh'))[0]?.kind).toBe('HOST_SCRIPT');
  });

  it('reports a native module at low confidence, because some resources ship one', () => {
    const found = findSuspiciousFiles(files('lib/native.dll'));
    expect(found[0]?.kind).toBe('NATIVE_MODULE');
    expect(found[0]?.confidence).toBeLessThan(0.5);
    expect(found[0]?.reason).toContain('legitimately');
  });

  it('orders findings by confidence so the most notable comes first', () => {
    const found = findSuspiciousFiles(files('lib/native.dll', 'helper.exe', 'archive.zip'));
    expect(found[0]?.kind).toBe('EXECUTABLE');
  });

  it('ignores a file with no extension', () => {
    expect(findSuspiciousFiles(files('LICENSE', 'Makefile'))).toEqual([]);
  });

  it('matches an extension case-insensitively', () => {
    expect(findSuspiciousFiles(files('Setup.EXE'))[0]?.kind).toBe('EXECUTABLE');
  });
});
