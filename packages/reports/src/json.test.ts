import { describe, expect, it } from 'vitest';
import { REPORT_SCHEMA_VERSION, validateReport, type SentinelReport } from '@sentinel-forge/shared';
import { renderJsonReport } from './json.js';

function report(overrides: Partial<SentinelReport> = {}): SentinelReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      productVersion: '0.1.0',
      command: 'scan',
      durationMs: 5,
      hostPlatform: 'linux-x64',
      nodeVersion: 'v22.22.2',
    },
    server: {
      id: 'srv_1',
      path: '/srv/fixture',
      resourceRoots: ['resources'],
      resourceCount: 0,
      fingerprint: 'abc',
      scannedAt: '2026-01-01T00:00:00.000Z',
    },
    resources: [],
    findings: [],
    incidents: [],
    limitations: ['Findings are indicators.'],
    ...overrides,
  };
}

describe('JSON report rendering', () => {
  it('renders a report that validates against the published schema', () => {
    const parsed: unknown = JSON.parse(renderJsonReport(report()));
    expect(validateReport(parsed, REPORT_SCHEMA_VERSION).valid).toBe(true);
  });

  it('writes keys in the canonical order, so two reports diff cleanly', () => {
    const parsed = JSON.parse(renderJsonReport(report())) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'generatedAt',
      'metadata',
      'server',
      'resources',
      'findings',
      'incidents',
      'limitations',
    ]);
  });

  it('omits a section that was not collected rather than emitting an empty one', () => {
    const parsed = JSON.parse(renderJsonReport(report())) as Record<string, unknown>;
    expect(Object.hasOwn(parsed, 'security')).toBe(false);
    expect(Object.hasOwn(parsed, 'performance')).toBe(false);
    expect(Object.hasOwn(parsed, 'health')).toBe(false);
  });

  it('refuses to render a report that violates the schema', () => {
    expect(() => renderJsonReport(report({ limitations: [] }))).toThrow(/Invalid Sentinel Forge report/);
  });

  it('is deterministic for identical input', () => {
    expect(renderJsonReport(report())).toBe(renderJsonReport(report()));
  });

  it('ends with a trailing newline, so the file is well-formed for tooling', () => {
    expect(renderJsonReport(report()).endsWith('}\n')).toBe(true);
  });
});
