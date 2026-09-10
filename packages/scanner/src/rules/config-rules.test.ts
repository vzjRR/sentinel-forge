import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@sentinel-forge/core';
import { parseServerConfig } from '../config/server-config.js';
import { analyzeServerConfig } from './config-rules.js';

const clock = createFixedClock(new Date('2026-01-01T00:00:00.000Z'));

function analyze(source: string, discovered: string[], provided: string[] = []): ReturnType<typeof analyzeServerConfig> {
  return analyzeServerConfig({
    config: parseServerConfig(source),
    configPath: 'server.cfg',
    discoveredResources: new Set(discovered),
    providedNames: new Set(provided),
    clock,
  });
}

describe('CFG-ENSURE-MISSING-001', () => {
  it('reports nothing when every started resource exists', () => {
    expect(analyze('ensure sf_core\nstart sf_hud', ['sf_core', 'sf_hud'])).toEqual([]);
  });

  it('reports a started resource that was not found', () => {
    const findings = analyze('ensure sf_missing', ['sf_core']);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'CFG-ENSURE-MISSING-001',
      severity: 'HIGH',
      file: 'server.cfg',
      line: 1,
    });
    expect(findings[0]?.evidence[0]?.excerpt).toBe('ensure sf_missing');
  });

  it('does not report a category target, which affects a group rather than one resource', () => {
    // `ensure [managers]` starts every resource in the category; the bracketed
    // name is never itself a resource.
    expect(analyze('ensure [managers]\nstart [gameplay]', ['sf_core'])).toEqual([]);
  });

  it('does not report a `stop` for something absent, which is harmless', () => {
    expect(analyze('stop sf_missing', ['sf_core'])).toEqual([]);
  });

  it('accepts a name satisfied by another resource declaring provide', () => {
    expect(analyze('ensure mysql-async', ['oxmysql'], ['mysql-async'])).toEqual([]);
  });

  it('records a resource from the official server data set at INFO with low confidence', () => {
    const findings = analyze('ensure mapmanager\nensure spawnmanager\nensure baseevents', ['sf_core']);
    expect(findings).toHaveLength(3);
    for (const finding of findings) {
      expect(finding.severity).toBe('INFO');
      expect(finding.confidence).toBeLessThanOrEqual(0.25);
      expect(finding.summary).toContain('official server data set');
    }
  });

  it('reports each missing target once, however many directives name it', () => {
    const findings = analyze('ensure sf_missing\nrestart sf_missing\nstart sf_missing', ['sf_core']);
    expect(findings).toHaveLength(1);
  });

  it('reports the target and command in metadata for downstream consumers', () => {
    const findings = analyze('restart sf_missing', []);
    expect(findings[0]?.metadata).toMatchObject({ target: 'sf_missing', command: 'restart', bundled: false });
  });
});
