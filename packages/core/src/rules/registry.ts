/**
 * Rule registry.
 *
 * Holds the rules available to a run and resolves which of them are active.
 * The registry validates against the published catalog at registration time:
 * a rule whose id or category drifts from the catalog is a contract break, and
 * is rejected immediately rather than producing findings a consumer cannot map.
 */

import { getRule, isKnownRuleId } from '@sentinel-forge/shared';
import { SentinelInternalError } from '../errors.js';
import type { RuleActivation, RuleDefinition } from './rule.js';

export class RuleRegistry {
  readonly #rules = new Map<string, RuleDefinition<unknown>>();

  /**
   * @throws {SentinelInternalError} when the id is unknown to the catalog,
   *   duplicated, or declares a category the catalog disagrees with.
   */
  register<TInput>(rule: RuleDefinition<TInput>): void {
    if (!isKnownRuleId(rule.id)) {
      throw new SentinelInternalError(
        `Cannot register rule "${rule.id}": it is not present in the rule catalog (packages/shared/src/rules/catalog.ts).`,
      );
    }
    if (this.#rules.has(rule.id)) {
      throw new SentinelInternalError(`Rule "${rule.id}" is already registered.`);
    }

    const catalogEntry = getRule(rule.id);
    if (catalogEntry !== undefined && catalogEntry.category !== rule.category) {
      throw new SentinelInternalError(
        `Rule "${rule.id}" declares category ${rule.category} but the catalog defines ${catalogEntry.category}.`,
      );
    }

    this.#rules.set(rule.id, rule);
  }

  has(ruleId: string): boolean {
    return this.#rules.has(ruleId);
  }

  get(ruleId: string): RuleDefinition<unknown> | undefined {
    return this.#rules.get(ruleId);
  }

  /** Registered rules, ordered by id so execution order is deterministic. */
  list(): readonly RuleDefinition<unknown>[] {
    return [...this.#rules.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get size(): number {
    return this.#rules.size;
  }

  /**
   * Resolves which registered rules run for this configuration.
   *
   * @param disabledRules - Rule ids disabled by the operator's configuration.
   */
  resolveActivations(disabledRules: readonly string[]): readonly RuleActivation[] {
    const disabled = new Set(disabledRules);
    return this.list().map((rule) =>
      disabled.has(rule.id)
        ? { ruleId: rule.id, enabled: false, reason: 'Disabled by configuration (analysis.disabledRules).' }
        : { ruleId: rule.id, enabled: true },
    );
  }
}

export function createRuleRegistry(): RuleRegistry {
  return new RuleRegistry();
}
