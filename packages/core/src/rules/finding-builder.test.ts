import { describe, expect, it } from 'vitest';
import type { Evidence } from '@sentinel-forge/shared';
import { SentinelInternalError } from '../errors.js';
import { createFinding, redactEvidence } from './finding-builder.js';

const evidence: Evidence[] = [
  {
    kind: 'FILE_REFERENCE',
    description: 'Manifest declares a dependency that was not found.',
    location: { file: 'resources/sf_shop/fxmanifest.lua', line: 7 },
    excerpt: "dependency 'sf_inventory'",
  },
];

const base = {
  ruleId: 'DEP-MISSING-001',
  severity: 'HIGH' as const,
  confidence: 0.95,
  title: 'Missing dependency',
  summary: 'Resource sf_shop declares a dependency on sf_inventory, which was not found.',
  recommendation: 'Install or enable sf_inventory, or remove the declaration if it is obsolete.',
  evidence,
  resource: 'sf_shop',
  file: 'resources/sf_shop/fxmanifest.lua',
  line: 7,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('finding construction', () => {
  it('builds a complete finding and takes the category from the catalog', () => {
    const finding = createFinding(base);
    expect(finding.category).toBe('DEPENDENCIES');
    expect(finding.ruleId).toBe('DEP-MISSING-001');
    expect(finding.id).toMatch(/^fnd_[0-9a-f]{16}$/);
  });

  it('produces the same id for the same observation', () => {
    expect(createFinding(base).id).toBe(createFinding(base).id);
  });

  it('rounds confidence so two runs serialize identically', () => {
    expect(createFinding({ ...base, confidence: 0.9549 }).confidence).toBe(0.95);
  });

  it('rejects a rule id that is not in the published catalog', () => {
    expect(() => createFinding({ ...base, ruleId: 'MADE-UP-001' })).toThrow(SentinelInternalError);
  });

  it('rejects a finding above INFO that carries no evidence', () => {
    expect(() => createFinding({ ...base, evidence: [] })).toThrow(/without evidence/);
  });

  it('permits an INFO finding without evidence', () => {
    expect(() => createFinding({ ...base, severity: 'INFO', evidence: [] })).not.toThrow();
  });

  it('rejects a finding with no recommendation, since findings must be actionable', () => {
    expect(() => createFinding({ ...base, recommendation: '   ' })).toThrow(/title or recommendation/);
  });

  it('redacts secrets in evidence excerpts before the finding leaves the rule', () => {
    const finding = createFinding({
      ...base,
      ruleId: 'SEC-SECRET-001',
      evidence: [
        {
          kind: 'CODE_PATTERN',
          description: 'Credential-shaped assignment detected.',
          excerpt: `local api_key = 'EXAMPLE_FIXTURE_API_KEY_0000'`,
        },
      ],
    });
    expect(finding.evidence[0]?.excerpt).not.toContain('EXAMPLE_FIXTURE_API_KEY_0000');
    expect(finding.evidence[0]?.excerpt).toContain('********');
  });

  it('redacts an evidence record in isolation', () => {
    const redacted = redactEvidence({
      kind: 'CONFIG_VALUE',
      description: 'password = "EXAMPLE_NOT_A_REAL_PASSWORD"',
    });
    expect(redacted.description).not.toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
  });

  it('omits optional fields rather than emitting undefined values', () => {
    const finding = createFinding({
      ruleId: 'INT-CHANGE-001',
      severity: 'INFO',
      confidence: 1,
      title: 'File changed',
      summary: 'A file changed between two snapshots.',
      recommendation: 'Confirm the change was expected.',
      evidence: [],
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(Object.hasOwn(finding, 'resource')).toBe(false);
    expect(Object.hasOwn(finding, 'line')).toBe(false);
  });
});
