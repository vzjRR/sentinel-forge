import { describe, expect, it } from 'vitest';
import { compareFindings, type Finding } from './finding.js';

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: 'fnd_test',
    ruleId: 'DEP-MISSING-001',
    category: 'DEPENDENCIES',
    severity: 'MEDIUM',
    confidence: 0.5,
    title: 'Test finding',
    summary: 'Test summary.',
    recommendation: 'Test recommendation.',
    evidence: [],
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('finding ordering', () => {
  it('orders by severity first, descending', () => {
    const sorted = [
      makeFinding({ severity: 'LOW' }),
      makeFinding({ severity: 'CRITICAL' }),
      makeFinding({ severity: 'MEDIUM' }),
    ].sort(compareFindings);
    expect(sorted.map((finding) => finding.severity)).toEqual(['CRITICAL', 'MEDIUM', 'LOW']);
  });

  it('orders equal severities by confidence, descending', () => {
    const sorted = [
      makeFinding({ severity: 'HIGH', confidence: 0.4 }),
      makeFinding({ severity: 'HIGH', confidence: 0.95 }),
    ].sort(compareFindings);
    expect(sorted.map((finding) => finding.confidence)).toEqual([0.95, 0.4]);
  });

  it('is a total order, so two runs over the same findings produce identical output', () => {
    const findings = [
      makeFinding({ ruleId: 'DEP-CYCLE-001', resource: 'b', file: 'b.lua', line: 2 }),
      makeFinding({ ruleId: 'DEP-CYCLE-001', resource: 'a', file: 'a.lua', line: 1 }),
      makeFinding({ ruleId: 'DEP-MISSING-001', resource: 'a', file: 'a.lua', line: 1 }),
      makeFinding({ ruleId: 'DEP-CYCLE-001', resource: 'a', file: 'a.lua', line: 9 }),
    ];
    const first = [...findings].sort(compareFindings).map((finding) => `${finding.ruleId}:${finding.resource}:${String(finding.line)}`);
    const second = [...findings].reverse().sort(compareFindings).map((finding) => `${finding.ruleId}:${finding.resource}:${String(finding.line)}`);
    expect(first).toEqual(second);
  });
});
