/**
 * Integration: the rule catalog tells the truth.
 *
 * The catalog is what `sentinel help rules` prints and what integrators read to
 * decide which rules to act on. A rule marked `IMPLEMENTED` that never runs
 * overstates the product; a rule marked `NOT_IMPLEMENTED` that does run
 * understates it, and hides real findings from anyone filtering by status.
 *
 * Both mistakes are easy to make — the catalog lives in one package and the
 * rules in several others — so the relationship is asserted rather than
 * maintained by hand.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getRule, listRules, listRulesByStatus } from '@sentinel-forge/shared';
import { repositoryRoot } from '../helpers/workspace.js';

/**
 * Rule ids that appear as a string literal in product source, outside the
 * catalog itself.
 *
 * Matching the literal rather than the `ruleId:` key is deliberate: a rule id
 * is frequently chosen by an expression (`isWebhook ? 'SEC-WEBHOOK-001' :
 * 'SEC-SECRET-001'`), and a key-anchored pattern would silently miss those and
 * report a working rule as unemitted.
 */
async function collectEmittedRuleIds(): Promise<Set<string>> {
  const emitted = new Set<string>();

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        await walk(absolute);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
      // The catalog names every id by definition; it is the declaration, not a use.
      if (absolute.endsWith(path.join('rules', 'catalog.ts'))) continue;

      const source = await readFile(absolute, 'utf8');
      for (const match of source.matchAll(/'((?:PERF|DEP|SEC|INT|CFG)-[A-Z-]+-\d{3})'/g)) {
        const id = match[1];
        if (id !== undefined) emitted.add(id);
      }
    }
  }

  await walk(path.join(repositoryRoot, 'packages'));
  await walk(path.join(repositoryRoot, 'apps'));
  return emitted;
}

describe('rule catalog accuracy', () => {
  it('marks every rule the product can emit as IMPLEMENTED', async () => {
    const emitted = await collectEmittedRuleIds();
    expect(emitted.size).toBeGreaterThan(5);

    for (const ruleId of emitted) {
      const rule = getRule(ruleId);
      expect(rule, `${ruleId} is emitted but absent from the catalog`).toBeDefined();
      expect(rule?.status, `${ruleId} is emitted but catalogued as ${rule?.status ?? 'unknown'}`).toBe('IMPLEMENTED');
    }
  });

  it('does not mark a rule IMPLEMENTED unless something emits it', async () => {
    const emitted = await collectEmittedRuleIds();
    for (const rule of listRulesByStatus('IMPLEMENTED')) {
      expect(emitted.has(rule.id), `${rule.id} is catalogued as IMPLEMENTED but nothing emits it`).toBe(true);
    }
  });

  it('gives every unimplemented rule a future gate', async () => {
    const emitted = await collectEmittedRuleIds();
    for (const rule of listRulesByStatus('NOT_IMPLEMENTED')) {
      expect(emitted.has(rule.id), `${rule.id} is emitted but marked NOT_IMPLEMENTED`).toBe(false);
      expect(rule.targetGate).toBeGreaterThan(0);
    }
  });

  it('names an owning package that exists for every rule', async () => {
    const packages = await readdir(path.join(repositoryRoot, 'packages'));
    for (const rule of listRules()) {
      const name = rule.implementedIn.replace('@sentinel-forge/', '');
      expect(packages, `${rule.id} names package ${rule.implementedIn}`).toContain(name);
    }
  });
});
