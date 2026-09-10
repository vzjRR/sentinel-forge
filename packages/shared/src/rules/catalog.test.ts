import { describe, expect, it } from 'vitest';
import { RULE_CATEGORIES, getRule, isKnownRuleId, listRules, listRulesByCategory, listRulesByStatus } from './catalog.js';
import { SEVERITIES } from '../severity.js';

/**
 * The catalog is a published contract. These tests guard the properties a
 * consumer depends on: ids are unique and stable, every entry is complete, and
 * the catalog does not claim a rule is implemented when it is not.
 */
describe('rule catalog', () => {
  const rules = listRules();

  it('contains every rule id named in the product specification', () => {
    const required = [
      'PERF-LOOP-001',
      'PERF-REGRESSION-001',
      'PERF-EVENT-001',
      'PERF-QUERY-001',
      'DEP-MISSING-001',
      'DEP-CYCLE-001',
      'SEC-SECRET-001',
      'SEC-OBFUSCATION-001',
      'SEC-REMOTE-LOAD-001',
      'SEC-WEBHOOK-001',
      'SEC-DYNAMIC-EXEC-001',
      'SEC-SUSPICIOUS-FILE-001',
      'INT-CHANGE-001',
      'CFG-MANIFEST-001',
      'CFG-MISSING-FILE-001',
    ];
    for (const id of required) {
      expect(isKnownRuleId(id), `${id} must exist in the catalog`).toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents rationale, false positives and evidence requirements for every rule', () => {
    for (const rule of rules) {
      expect(rule.rationale.length, `${rule.id} rationale`).toBeGreaterThan(20);
      expect(rule.description.length, `${rule.id} description`).toBeGreaterThan(20);
      expect(rule.falsePositives.length, `${rule.id} must document known false positives`).toBeGreaterThan(0);
      expect(rule.evidenceRequirements.length, `${rule.id} must state its evidence requirements`).toBeGreaterThan(0);
    }
  });

  it('uses only declared categories and severities', () => {
    for (const rule of rules) {
      expect(RULE_CATEGORIES).toContain(rule.category);
      expect(SEVERITIES).toContain(rule.defaultSeverity);
    }
  });

  it('reports delivery status honestly for this build', () => {
    // GATE 0 delivers the foundation only; no rule executes yet. If a rule is
    // marked IMPLEMENTED it must have an owning package and a gate at or below
    // the gate that shipped it.
    for (const rule of listRulesByStatus('IMPLEMENTED')) {
      expect(rule.implementedIn.startsWith('@sentinel-forge/'), `${rule.id} owner package`).toBe(true);
    }
    for (const rule of listRulesByStatus('NOT_IMPLEMENTED')) {
      expect(rule.targetGate).toBeGreaterThan(0);
    }
  });

  it('resolves rules by id and by category', () => {
    expect(getRule('DEP-MISSING-001')?.category).toBe('DEPENDENCIES');
    expect(getRule('does-not-exist')).toBeUndefined();
    expect(listRulesByCategory('SECURITY').every((rule) => rule.id.startsWith('SEC-'))).toBe(true);
  });
});
