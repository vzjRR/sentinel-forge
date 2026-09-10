import { describe, expect, it } from 'vitest';
import { SentinelInternalError } from '../errors.js';
import { createRuleRegistry } from './registry.js';
import type { RuleDefinition } from './rule.js';

function stubRule(overrides: Partial<RuleDefinition<string>> = {}): RuleDefinition<string> {
  return {
    id: 'DEP-MISSING-001',
    category: 'DEPENDENCIES',
    defaultSeverity: 'HIGH',
    description: 'Stub rule used in tests.',
    rationale: 'Stub rationale.',
    falsePositives: ['None; this rule exists only in tests.'],
    analyze: () => [],
    ...overrides,
  };
}

describe('rule registry', () => {
  it('registers a rule that matches the catalog', () => {
    const registry = createRuleRegistry();
    registry.register(stubRule());
    expect(registry.size).toBe(1);
    expect(registry.has('DEP-MISSING-001')).toBe(true);
  });

  it('rejects a rule id that is not in the catalog', () => {
    const registry = createRuleRegistry();
    expect(() => registry.register(stubRule({ id: 'MADE-UP-001' }))).toThrow(SentinelInternalError);
  });

  it('rejects a category that disagrees with the catalog', () => {
    const registry = createRuleRegistry();
    expect(() => registry.register(stubRule({ category: 'SECURITY' }))).toThrow(/catalog defines DEPENDENCIES/);
  });

  it('rejects a duplicate registration', () => {
    const registry = createRuleRegistry();
    registry.register(stubRule());
    expect(() => registry.register(stubRule())).toThrow(/already registered/);
  });

  it('lists rules in a deterministic order', () => {
    const registry = createRuleRegistry();
    registry.register(stubRule({ id: 'DEP-MISSING-001' }));
    registry.register(stubRule({ id: 'DEP-CYCLE-001' }));
    expect(registry.list().map((rule) => rule.id)).toEqual(['DEP-CYCLE-001', 'DEP-MISSING-001']);
  });

  it('reports why a rule will not run when it is disabled by configuration', () => {
    const registry = createRuleRegistry();
    registry.register(stubRule({ id: 'DEP-MISSING-001' }));
    registry.register(stubRule({ id: 'DEP-CYCLE-001' }));

    const activations = registry.resolveActivations(['DEP-CYCLE-001']);
    expect(activations).toEqual([
      { ruleId: 'DEP-CYCLE-001', enabled: false, reason: 'Disabled by configuration (analysis.disabledRules).' },
      { ruleId: 'DEP-MISSING-001', enabled: true },
    ]);
  });
});
