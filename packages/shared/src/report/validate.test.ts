import { describe, expect, it } from 'vitest';
import { assertValidReport, validateReport } from './validate.js';
import { BASE_LIMITATIONS, type SentinelReport } from './schema.js';
import { REPORT_SCHEMA_VERSION } from '../product.js';

function validReport(): SentinelReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      productVersion: '0.1.0',
      command: 'scan',
      durationMs: 12,
      hostPlatform: 'linux-x64',
      nodeVersion: 'v22.22.2',
    },
    server: {
      id: 'srv_test',
      path: '/srv/fixture',
      resourceRoots: ['resources'],
      resourceCount: 1,
      fingerprint: 'abc123',
      scannedAt: '2026-01-01T00:00:00.000Z',
    },
    resources: [],
    findings: [],
    incidents: [],
    limitations: [...BASE_LIMITATIONS],
  };
}

describe('report schema validation', () => {
  it('accepts a well-formed report', () => {
    const result = validateReport(validReport(), REPORT_SCHEMA_VERSION);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('reports a schema version mismatch instead of throwing', () => {
    const result = validateReport({ ...validReport(), schemaVersion: '9.9' }, REPORT_SCHEMA_VERSION);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toBe('schemaVersion');
  });

  it('requires limitations to be present, so a report never overstates its conclusions', () => {
    const result = validateReport({ ...validReport(), limitations: [] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'limitations')).toBe(true);
  });

  it('requires evidence for findings above INFO severity', () => {
    const report = {
      ...validReport(),
      findings: [
        {
          id: 'fnd_1',
          ruleId: 'DEP-MISSING-001',
          category: 'DEPENDENCIES',
          severity: 'HIGH',
          confidence: 0.9,
          title: 'Missing dependency',
          summary: 'A declared dependency was not found.',
          recommendation: 'Install the dependency.',
          evidence: [],
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'findings[0].evidence')).toBe(true);
  });

  it('permits an INFO finding without evidence', () => {
    const report = {
      ...validReport(),
      findings: [
        {
          id: 'fnd_1',
          ruleId: 'INT-CHANGE-001',
          category: 'INTEGRITY',
          severity: 'INFO',
          confidence: 1,
          title: 'File changed',
          summary: 'A file changed between snapshots.',
          recommendation: 'Confirm the change was expected.',
          evidence: [],
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    expect(validateReport(report).valid).toBe(true);
  });

  it('rejects an out-of-range confidence', () => {
    const report = {
      ...validReport(),
      findings: [
        {
          id: 'fnd_1',
          ruleId: 'DEP-MISSING-001',
          category: 'DEPENDENCIES',
          severity: 'INFO',
          confidence: 42,
          title: 'Missing dependency',
          summary: 'Summary.',
          recommendation: 'Recommendation.',
          evidence: [],
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    expect(validateReport(report).valid).toBe(false);
  });

  it('collects every issue in one pass rather than stopping at the first', () => {
    const result = validateReport({ schemaVersion: '1.0' });
    expect(result.issues.length).toBeGreaterThan(3);
  });

  it('throws with a combined message from assertValidReport', () => {
    expect(() => {
      assertValidReport({});
    }).toThrow(/Invalid Sentinel Forge report/);
  });
});
