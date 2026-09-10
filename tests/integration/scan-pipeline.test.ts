/**
 * Integration: server → scan → database → findings → report.
 *
 * Runs the real pipeline against the synthetic fixtures and asserts the two
 * properties that matter most for a diagnostic tool: it finds what is actually
 * wrong, and it stays silent about what is not.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase } from '@sentinel-forge/core';
import { EXIT_CODES, REPORT_SCHEMA_VERSION, validateReport } from '@sentinel-forge/shared';
import { createWorkspace, fixturePath, parseJsonOutput, removeWorkspace, runCli } from '../helpers/workspace.js';

interface ScanPayload {
  readonly summary: {
    readonly resources: number;
    readonly findings: number;
    readonly unresolvedDependencies: number;
    readonly cycles: number;
    readonly recorded: boolean;
  };
  readonly findings: { readonly ruleId: string; readonly severity: string; readonly resource?: string; readonly line?: number }[];
}

async function scan(fixture: string, workspace: string, extra: string[] = []): Promise<ScanPayload & { exitCode: number }> {
  const result = await runCli(['scan', '--server', fixturePath(fixture), '--json', ...extra], workspace);
  return { ...parseJsonOutput<ScanPayload>(result), exitCode: result.exitCode };
}

describe('scan pipeline', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await createWorkspace('sentinel-scan-');
    await runCli(['init'], workspace);
  });

  afterEach(async () => {
    await removeWorkspace(workspace);
  });

  it('reports nothing on the healthy fixture and exits 0', async () => {
    // The false-positive control: a clean server must produce a clean report.
    const payload = await scan('healthy-server', workspace);
    expect(payload.findings).toEqual([]);
    expect(payload.summary.resources).toBe(2);
    expect(payload.exitCode).toBe(EXIT_CODES.SUCCESS);
  });

  it('detects the missing dependency and exits 1', async () => {
    const payload = await scan('missing-dependency', workspace);
    const missing = payload.findings.filter((finding) => finding.ruleId === 'DEP-MISSING-001');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ severity: 'HIGH', resource: 'sf_shop', line: 7 });
    expect(payload.exitCode).toBe(EXIT_CODES.FINDINGS);
  });

  it('detects both the unparsable manifest and the missing file', async () => {
    const payload = await scan('broken-manifest', workspace);
    const rules = new Set(payload.findings.map((finding) => finding.ruleId));
    expect(rules.has('CFG-MANIFEST-001')).toBe(true);
    expect(rules.has('CFG-MISSING-FILE-001')).toBe(true);

    const missingFile = payload.findings.find((finding) => finding.ruleId === 'CFG-MISSING-FILE-001');
    expect(missingFile).toMatchObject({ resource: 'sf_broken', severity: 'HIGH' });
  });

  it('detects the dependency cycle and the missing dependency on the mixed fixture', async () => {
    const payload = await scan('mixed-server', workspace);
    expect(payload.summary.cycles).toBe(1);
    expect(payload.summary.unresolvedDependencies).toBe(1);
    expect(payload.findings.some((finding) => finding.ruleId === 'DEP-CYCLE-001')).toBe(true);
    expect(payload.findings.some((finding) => finding.ruleId === 'DEP-MISSING-001')).toBe(true);
  });

  it('reports every rule each fixture declares it should trigger', async () => {
    for (const fixture of ['missing-dependency', 'broken-manifest', 'mixed-server']) {
      const manifest = JSON.parse(await readFile(fixturePath(fixture, 'fixture.json'), 'utf8')) as {
        expectedRules: string[];
      };
      const payload = await scan(fixture, workspace);
      const reported = new Set(payload.findings.map((finding) => finding.ruleId));

      for (const ruleId of manifest.expectedRules) {
        // Only rules delivered by this gate are asserted; the rest are the
        // declared expectation for a later gate.
        if (!ruleId.startsWith('DEP-') && !ruleId.startsWith('CFG-')) continue;
        expect(reported.has(ruleId), `${fixture} should report ${ruleId}`).toBe(true);
      }
    }
  });

  it('records the scan in the local database', async () => {
    await scan('mixed-server', workspace);

    let database: OpenedDatabase | undefined;
    try {
      database = openDatabase({ location: path.join(workspace, '.sentinel', 'sentinel.db') });
      const { driver } = database;

      const servers = driver.prepare('SELECT COUNT(*) AS count FROM servers').get<{ count: number }>();
      const runs = driver.prepare('SELECT COUNT(*) AS count FROM scan_runs').get<{ count: number }>();
      const resources = driver.prepare('SELECT name FROM resources ORDER BY name').all<{ name: string }>();
      const findings = driver.prepare('SELECT rule_id AS ruleId FROM findings').all<{ ruleId: string }>();
      const dependencies = driver.prepare('SELECT COUNT(*) AS count FROM dependencies').get<{ count: number }>();
      const files = driver.prepare('SELECT COUNT(*) AS count FROM resource_files').get<{ count: number }>();

      expect(servers?.count).toBe(1);
      expect(runs?.count).toBe(1);
      expect(resources.map((row) => row.name)).toEqual(['sf_core', 'sf_cycle_a', 'sf_cycle_b', 'sf_heavy', 'sf_shop']);
      expect(findings.length).toBeGreaterThan(0);
      expect(dependencies?.count).toBeGreaterThan(0);
      expect(files?.count).toBeGreaterThan(0);
    } finally {
      database?.close();
    }
  });

  it('is idempotent: re-scanning updates rather than duplicating', async () => {
    const first = await scan('mixed-server', workspace);
    const second = await scan('mixed-server', workspace);

    expect(second.findings.map((finding) => finding.ruleId).sort()).toEqual(
      first.findings.map((finding) => finding.ruleId).sort(),
    );

    let database: OpenedDatabase | undefined;
    try {
      database = openDatabase({ location: path.join(workspace, '.sentinel', 'sentinel.db') });
      const { driver } = database;
      expect(driver.prepare('SELECT COUNT(*) AS count FROM servers').get<{ count: number }>()?.count).toBe(1);
      expect(driver.prepare('SELECT COUNT(*) AS count FROM resources').get<{ count: number }>()?.count).toBe(5);
      // Two runs are recorded; the findings they produced are the same rows.
      expect(driver.prepare('SELECT COUNT(*) AS count FROM scan_runs').get<{ count: number }>()?.count).toBe(2);
      const findingCount = driver.prepare('SELECT COUNT(*) AS count FROM findings').get<{ count: number }>()?.count ?? 0;
      expect(findingCount).toBe(first.findings.length);
    } finally {
      database?.close();
    }
  });

  it('produces deterministic finding ids across runs', async () => {
    const first = await runCli(['scan', '--server', fixturePath('mixed-server'), '--json'], workspace);
    const second = await runCli(['scan', '--server', fixturePath('mixed-server'), '--json'], workspace);
    const ids = (result: typeof first): string[] =>
      parseJsonOutput<{ findings: { id: string }[] }>(result).findings.map((finding) => finding.id);
    expect(ids(first)).toEqual(ids(second));
  });

  it('writes a JSON report that validates against the published schema', async () => {
    const target = path.join(workspace, '.sentinel', 'reports', 'out.json');
    const result = await runCli(
      ['report', '--server', fixturePath('mixed-server'), '--format', 'json', '--output', target, '--json'],
      workspace,
    );
    expect([EXIT_CODES.SUCCESS, EXIT_CODES.FINDINGS]).toContain(result.exitCode);

    const parsed: unknown = JSON.parse(await readFile(target, 'utf8'));
    const validation = validateReport(parsed, REPORT_SCHEMA_VERSION);
    expect(validation.issues).toEqual([]);
  });

  it('writes a Markdown report containing the findings and the limitations', async () => {
    const target = path.join(workspace, '.sentinel', 'reports', 'out.md');
    await runCli(
      ['report', '--server', fixturePath('mixed-server'), '--format', 'markdown', '--output', target],
      workspace,
    );
    const markdown = await readFile(target, 'utf8');
    expect(markdown).toContain('# Sentinel Forge report');
    expect(markdown).toContain('DEP-MISSING-001');
    expect(markdown).toContain('## Limitations');
  });

  it('reports the dependency graph, keeping runtime constraints out of it', async () => {
    const result = await runCli(['dependencies', '--server', fixturePath('mixed-server'), '--json'], workspace);
    const payload = parseJsonOutput<{
      nodes: string[];
      edges: { from: string; to: string; resolved: boolean }[];
      cycles: string[][];
      runtimeConstraints: unknown[];
    }>(result);

    expect(payload.nodes).toHaveLength(5);
    expect(payload.cycles).toEqual([['sf_cycle_a', 'sf_cycle_b']]);
    expect(payload.edges.some((edge) => edge.to === 'sf_inventory' && !edge.resolved)).toBe(true);
    expect(payload.runtimeConstraints).toEqual([]);
  });

  it('refuses to scan a server path that does not exist, with an example command', async () => {
    const result = await runCli(['scan', '--server', path.join(workspace, 'nope')], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('Server path does not exist');
    expect(result.stderr).toContain('--server');
  });

  it('requires a server path rather than guessing one', async () => {
    const result = await runCli(['scan'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('No server path is configured');
  });

  it('detects every static performance smell in the performance fixture', async () => {
    const payload = await scan('performance-smell', workspace);
    const rules = payload.findings.map((finding) => finding.ruleId);
    expect(rules).toContain('PERF-LOOP-001');
    expect(rules).toContain('PERF-EVENT-001');
    expect(rules).toContain('PERF-QUERY-001');
  });

  it('does not report the Wait(0) control loop in that fixture', async () => {
    // hud.lua exists purely as a false-positive control for PERF-LOOP-001.
    const payload = await scan('performance-smell', workspace);
    const hudLoopFindings = payload.findings.filter(
      (finding) => finding.ruleId === 'PERF-LOOP-001' && (finding as { file?: string }).file?.includes('hud.lua'),
    );
    expect(hudLoopFindings).toEqual([]);
  });

  it('scores health with deductions that sum to the score', async () => {
    const result = await runCli(['health', '--server', fixturePath('mixed-server'), '--json'], workspace);
    const payload = parseJsonOutput<{
      health: {
        score: number;
        categories: { category: string; score: number; deductions: { points: number; findingId: string }[] }[];
        unavailable?: Record<string, string>;
        complete: boolean;
      };
    }>(result);

    expect(payload.health.score).toBeGreaterThanOrEqual(0);
    expect(payload.health.score).toBeLessThanOrEqual(100);
    for (const category of payload.health.categories) {
      const total = category.deductions.reduce((sum, deduction) => sum + deduction.points, 0);
      expect(category.score, category.category).toBe(Math.max(0, 100 - total));
    }
    // Categories with no analysis behind them are named, not scored.
    expect(payload.health.complete).toBe(false);
    expect(Object.keys(payload.health.unavailable ?? {})).toContain('SECURITY');
  });

  it('reports 100 with no deductions on the healthy fixture', async () => {
    const result = await runCli(['health', '--server', fixturePath('healthy-server'), '--json'], workspace);
    const payload = parseJsonOutput<{ health: { score: number } }>(result);
    expect(payload.health.score).toBe(100);
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
  });

  it('shows one resource with its health, dependencies and events', async () => {
    const result = await runCli(['resource', 'sf_shop', '--server', fixturePath('mixed-server'), '--json'], workspace);
    const payload = parseJsonOutput<{
      resource: { name: string };
      health: { score: number };
      dependencies: string[];
      findings: { ruleId: string }[];
    }>(result);

    expect(payload.resource.name).toBe('sf_shop');
    expect(payload.dependencies).toContain('sf_inventory');
    expect(payload.findings.some((finding) => finding.ruleId === 'DEP-MISSING-001')).toBe(true);
    expect(payload.health.score).toBeLessThan(100);
  });

  it('names the available resources when asked for one that does not exist', async () => {
    const result = await runCli(['resource', 'sf_nope', '--server', fixturePath('mixed-server')], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('sf_core');
  });

  it('includes the event graph in the report', async () => {
    const result = await runCli(['scan', '--server', fixturePath('performance-smell'), '--format', 'json'], workspace);
    const report = JSON.parse(result.stdout) as {
      events?: { eventCount: number; triggeredButNotRegistered: string[] };
    };
    expect(report.events?.eventCount).toBeGreaterThan(0);
    // sf_heavy:position is registered in server.lua, so it resolves; the
    // heartbeat event is triggered by the client and handled nowhere.
    expect(report.events?.triggeredButNotRegistered).toContain('sf_heavy:heartbeat');
    expect(report.events?.triggeredButNotRegistered).not.toContain('sf_heavy:position');
  });

  it('honours a disabled rule from configuration', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      path.join(workspace, 'sentinel.config.json'),
      JSON.stringify({ analysis: { disabledRules: ['DEP-MISSING-001'] } }),
      'utf8',
    );
    const payload = await scan('missing-dependency', workspace);
    expect(payload.findings.some((finding) => finding.ruleId === 'DEP-MISSING-001')).toBe(false);
  });

  it('applies the minimum severity filter to reported findings', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      path.join(workspace, 'sentinel.config.json'),
      JSON.stringify({ analysis: { minimumSeverity: 'CRITICAL' } }),
      'utf8',
    );
    const payload = await scan('mixed-server', workspace);
    expect(payload.findings).toEqual([]);
  });
});
