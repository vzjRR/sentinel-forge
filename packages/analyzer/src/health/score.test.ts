import { describe, expect, it } from 'vitest';
import type { Finding, HealthCategory, RuleCategory, Severity } from '@sentinel-forge/shared';
import { CATEGORY_WEIGHTS, computeHealth, computeResourceHealth, SCORE_CAPS, SEVERITY_POINTS } from './score.js';

let counter = 0;

function finding(severity: Severity, category: RuleCategory, confidence = 1, resource = 'sf_test'): Finding {
  counter += 1;
  return {
    id: `fnd_${String(counter)}`,
    ruleId: category === 'PERFORMANCE' ? 'PERF-LOOP-001' : 'DEP-MISSING-001',
    category,
    severity,
    confidence,
    title: `${severity} finding`,
    summary: 'Summary.',
    recommendation: 'Recommendation.',
    evidence: [{ kind: 'CODE_PATTERN', description: 'Observed.' }],
    resource,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

const ALL: readonly HealthCategory[] = [
  'PERFORMANCE',
  'SECURITY',
  'RELIABILITY',
  'DEPENDENCIES',
  'CONFIGURATION',
  'INTEGRITY',
];

describe('health scoring', () => {
  it('scores a clean server at 100', () => {
    const health = computeHealth({ findings: [], availableCategories: ALL });
    expect(health.score).toBe(100);
    expect(health.complete).toBe(true);
    expect(health.primaryReasons[0]).toContain('No findings');
  });

  it('traces every deduction back to the finding that caused it', () => {
    const one = finding('MEDIUM', 'PERFORMANCE');
    const health = computeHealth({ findings: [one], availableCategories: ALL });
    const performance = health.categories.find((category) => category.category === 'PERFORMANCE');

    expect(performance?.deductions).toHaveLength(1);
    expect(performance?.deductions[0]).toMatchObject({ findingId: one.id, ruleId: one.ruleId, severity: 'MEDIUM' });
    // The deductions sum to the category score: nothing is deducted anonymously.
    const total = (performance?.deductions ?? []).reduce((sum, deduction) => sum + deduction.points, 0);
    expect(performance?.score).toBe(100 - total);
  });

  it('weights a deduction by the confidence of its finding', () => {
    const certain = computeHealth({ findings: [finding('MEDIUM', 'PERFORMANCE', 1)], availableCategories: ALL });
    const unsure = computeHealth({ findings: [finding('MEDIUM', 'PERFORMANCE', 0.5)], availableCategories: ALL });
    expect(certain.score).toBeLessThan(unsure.score);
  });

  it('deducts nothing for an INFO finding', () => {
    const health = computeHealth({ findings: [finding('INFO', 'DEPENDENCIES')], availableCategories: ALL });
    expect(health.score).toBe(100);
    expect(SEVERITY_POINTS.INFO).toBe(0);
  });

  it('caps the score when a CRITICAL finding is present', () => {
    const health = computeHealth({ findings: [finding('CRITICAL', 'SECURITY')], availableCategories: ALL });
    expect(health.score).toBeLessThanOrEqual(SCORE_CAPS.CRITICAL.score);
    expect(health.cap?.reason).toContain('CRITICAL');
    expect(health.primaryReasons[0]).toBe(health.cap?.reason);
  });

  it('caps the score when a high-confidence HIGH finding is present', () => {
    const health = computeHealth({ findings: [finding('HIGH', 'DEPENDENCIES', 0.95)], availableCategories: ALL });
    expect(health.score).toBeLessThanOrEqual(SCORE_CAPS.HIGH.score);
    expect(health.cap?.reason).toContain('HIGH');
  });

  it('does not cap on a low-confidence HIGH finding', () => {
    const health = computeHealth({ findings: [finding('HIGH', 'DEPENDENCIES', 0.4)], availableCategories: ALL });
    expect(health.cap).toBeUndefined();
  });

  it('reports an unscored category as unavailable instead of giving it a value', () => {
    const health = computeHealth({
      findings: [],
      availableCategories: ['CONFIGURATION'],
      unavailableReasons: { SECURITY: 'Security analysis is not implemented.' },
    });
    expect(health.complete).toBe(false);
    expect(health.categories.map((category) => category.category)).toEqual(['CONFIGURATION']);
    expect(health.unavailable?.['SECURITY']).toBe('Security analysis is not implemented.');
    expect(health.unavailable?.['INTEGRITY']).toContain('Not analyzed');
  });

  it('averages only the categories that were scored', () => {
    // One MEDIUM performance finding, with performance the only scored category.
    const health = computeHealth({
      findings: [finding('MEDIUM', 'PERFORMANCE')],
      availableCategories: ['PERFORMANCE'],
    });
    expect(health.score).toBe(100 - SEVERITY_POINTS.MEDIUM);
  });

  it('weights security and performance above configuration', () => {
    expect(CATEGORY_WEIGHTS.SECURITY).toBeGreaterThan(CATEGORY_WEIGHTS.CONFIGURATION);
    expect(CATEGORY_WEIGHTS.PERFORMANCE).toBeGreaterThan(CATEGORY_WEIGHTS.CONFIGURATION);
  });

  it('never returns a score outside 0..100, however many findings there are', () => {
    const many = Array.from({ length: 50 }, () => finding('HIGH', 'PERFORMANCE'));
    const health = computeHealth({ findings: many, availableCategories: ALL });
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
    expect(health.categories.find((category) => category.category === 'PERFORMANCE')?.score).toBe(0);
  });

  it('groups primary reasons by rule rather than listing every finding', () => {
    const many = Array.from({ length: 12 }, () => finding('LOW', 'CONFIGURATION'));
    const health = computeHealth({ findings: many, availableCategories: ALL });
    const grouped = health.primaryReasons.find((reason) => reason.includes('12'));
    expect(grouped).toBeDefined();
  });

  it('scores one resource from its own findings only', () => {
    const findings = [finding('HIGH', 'PERFORMANCE', 1, 'sf_a'), finding('MEDIUM', 'PERFORMANCE', 1, 'sf_b')];
    const a = computeResourceHealth('sf_a', findings, ['PERFORMANCE']);
    const b = computeResourceHealth('sf_b', findings, ['PERFORMANCE']);
    expect(a.score).toBeLessThan(b.score);
    expect(a.categories[0]?.deductions).toHaveLength(1);
  });

  it('is deterministic for the same findings', () => {
    const findings = [finding('HIGH', 'PERFORMANCE'), finding('LOW', 'CONFIGURATION')];
    expect(JSON.stringify(computeHealth({ findings, availableCategories: ALL }))).toBe(
      JSON.stringify(computeHealth({ findings, availableCategories: ALL })),
    );
  });
});
