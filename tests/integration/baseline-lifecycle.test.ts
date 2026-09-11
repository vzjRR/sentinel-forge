/**
 * Integration: baseline → change → baseline → compare → incident → purge.
 *
 * This is the workflow the product exists for. A change is made to a real
 * server tree between two baselines, and the test asserts that Sentinel Forge
 * finds the change, relates it to its effect, and words the relationship
 * without claiming a cause.
 */

import { appendFile, cp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { createWorkspace, fixturePath, parseJsonOutput, removeWorkspace, runCli } from '../helpers/workspace.js';

describe('baseline lifecycle', () => {
  let workspace: string;
  let server: string;

  beforeEach(async () => {
    workspace = await createWorkspace('sentinel-baseline-');
    server = path.join(workspace, 'server');
    await cp(fixturePath('healthy-server'), server, { recursive: true });
    await runCli(['init', '--server', server], workspace);
  });

  afterEach(async () => {
    await removeWorkspace(workspace);
  });

  /** Introduces a real defect into the server tree. */
  async function introduceRegression(): Promise<void> {
    await appendFile(
      path.join(server, 'resources', 'sf_core', 'client', 'main.lua'),
      ['', 'CreateThread(function()', '    while true do', '        heavyWork()', '    end', 'end)', ''].join('\n'),
      'utf8',
    );
  }

  it('records a baseline with resource hashes and the findings that stood', async () => {
    const result = await runCli(['baseline', 'create', 'before', '--json'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);

    const payload = parseJsonOutput<{ baseline: { label: string; resourceCount: number; sampleCount: number; healthScore: number } }>(result);
    expect(payload.baseline.label).toBe('before');
    expect(payload.baseline.resourceCount).toBe(2);
    expect(payload.baseline.healthScore).toBe(100);
    // No collector is installed on this fixture server, so the honest sample
    // count is zero. It is never estimated from static analysis.
    expect(payload.baseline.sampleCount).toBe(0);
  });

  it('refuses to record two baselines with the same label', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    const second = await runCli(['baseline', 'create', 'before'], workspace);
    expect(second.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(second.stderr).toContain('already exists');
  });

  it('lists and shows recorded baselines', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    const list = await runCli(['baseline', 'list', '--json'], workspace);
    expect(parseJsonOutput<{ baselines: unknown[] }>(list).baselines).toHaveLength(1);

    const show = await runCli(['baseline', 'show', 'before', '--json'], workspace);
    const shown = parseJsonOutput<{ resources: { resource: string; contentHash: string }[] }>(show);
    expect(shown.resources.map((entry) => entry.resource).sort()).toEqual(['sf_core', 'sf_hud']);
    expect(shown.resources[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects the change, the new finding and the health drop between two baselines', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    await introduceRegression();
    await runCli(['baseline', 'create', 'after'], workspace);

    const result = await runCli(['compare', 'before', 'after', '--json'], workspace);
    const payload = parseJsonOutput<{
      resourceChanges: { resource: string; kind: string; details: string[] }[];
      findingChanges: { kind: string; ruleId: string }[];
      healthDelta: number | null;
      incidents: { confidence: number; summary: string; affectedResources: string[]; recommendation: string }[];
      performance: { compared: boolean; reason?: string };
    }>(result);

    expect(payload.resourceChanges).toHaveLength(1);
    expect(payload.resourceChanges[0]).toMatchObject({ resource: 'sf_core', kind: 'MODIFIED' });
    expect(payload.findingChanges.some((change) => change.kind === 'INTRODUCED' && change.ruleId === 'PERF-LOOP-001')).toBe(true);
    expect(payload.healthDelta).toBeLessThan(0);
    expect(result.exitCode).toBe(EXIT_CODES.FINDINGS);
  });

  it('relates the change to its effect without claiming a cause', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    await introduceRegression();
    await runCli(['baseline', 'create', 'after'], workspace);

    const result = await runCli(['compare', 'before', 'after', '--json'], workspace);
    const payload = parseJsonOutput<{
      incidents: { confidence: number; summary: string; affectedResources: string[]; recommendation: string }[];
    }>(result);

    expect(payload.incidents).toHaveLength(1);
    const incident = payload.incidents[0];
    expect(incident?.affectedResources).toContain('sf_core');
    expect(incident?.confidence).toBeGreaterThan(0);
    expect(incident?.confidence).toBeLessThanOrEqual(0.85);
    expect(incident?.summary).toContain('does not establish causation');
    expect(incident?.summary).not.toMatch(/caused by|is responsible for|due to/i);
  });

  it('says plainly that performance was not compared, rather than implying no regression', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    await runCli(['baseline', 'create', 'after'], workspace);

    const result = await runCli(['compare', 'before', 'after', '--json'], workspace);
    const payload = parseJsonOutput<{ performance: { compared: boolean; reason: string } }>(result);
    expect(payload.performance.compared).toBe(false);
    expect(payload.performance.reason).toContain('sentinel_doctor collector');
    expect(payload.performance.reason).toContain('sentinel runtime import');
  });

  it('lists the incident it recorded', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    await introduceRegression();
    await runCli(['baseline', 'create', 'after'], workspace);
    await runCli(['compare', 'before', 'after'], workspace);

    const result = await runCli(['incidents', '--json'], workspace);
    const payload = parseJsonOutput<{ incidents: { events: unknown[] }[] }>(result);
    expect(payload.incidents).toHaveLength(1);
    expect(payload.incidents[0]?.events.length).toBeGreaterThanOrEqual(2);
  });

  it('reports no incidents before any comparison has been made', async () => {
    await runCli(['scan'], workspace);
    const result = await runCli(['incidents', '--json'], workspace);
    expect(parseJsonOutput<{ incidents: unknown[] }>(result).incidents).toEqual([]);
  });

  it('names the missing baseline when a comparison cannot be made', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    const result = await runCli(['compare', 'before', 'nope'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('"nope"');
  });

  it('deletes a baseline without touching the server', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    const result = await runCli(['baseline', 'delete', 'before', '--json'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);

    const list = await runCli(['baseline', 'list', '--json'], workspace);
    expect(parseJsonOutput<{ baselines: unknown[] }>(list).baselines).toEqual([]);

    const { readdir } = await import('node:fs/promises');
    expect(await readdir(path.join(server, 'resources'))).toEqual(expect.arrayContaining(['sf_core', 'sf_hud']));
  });

  it('purges as a dry run by default and deletes only when confirmed', async () => {
    await runCli(['scan'], workspace);

    const dryRun = await runCli(['purge', 'all', '--json'], workspace);
    const dryPayload = parseJsonOutput<{ dryRun: boolean; total: number }>(dryRun);
    expect(dryPayload.dryRun).toBe(true);
    expect(dryPayload.total).toBeGreaterThan(0);

    const stillThere = await runCli(['scan', '--json'], workspace);
    expect(stillThere.exitCode).toBe(EXIT_CODES.SUCCESS);

    const confirmed = await runCli(['purge', 'all', '--confirm', '--json'], workspace);
    expect(parseJsonOutput<{ dryRun: boolean }>(confirmed).dryRun).toBe(false);

    const incidents = await runCli(['incidents', '--json'], workspace);
    expect(incidents.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
  });

  it('leaves the server untouched through the whole lifecycle', async () => {
    const { readdir, stat } = await import('node:fs/promises');
    const before = await readdir(path.join(server, 'resources', 'sf_core'), { recursive: true });
    const manifestBefore = await stat(path.join(server, 'resources', 'sf_core', 'fxmanifest.lua'));

    await runCli(['baseline', 'create', 'a'], workspace);
    await runCli(['baseline', 'create', 'b'], workspace);
    await runCli(['compare', 'a', 'b'], workspace);
    await runCli(['purge', 'all', '--confirm'], workspace);

    expect(await readdir(path.join(server, 'resources', 'sf_core'), { recursive: true })).toEqual(before);
    const manifestAfter = await stat(path.join(server, 'resources', 'sf_core', 'fxmanifest.lua'));
    expect(manifestAfter.mtimeMs).toBe(manifestBefore.mtimeMs);
  });
});

describe('integrity lifecycle', () => {
  let workspace: string;
  let server: string;

  beforeEach(async () => {
    workspace = await createWorkspace('sentinel-integrity-');
    server = path.join(workspace, 'server');
    await cp(fixturePath('integrity-change', 'before'), server, { recursive: true });
    await runCli(['init', '--server', server], workspace);
  });

  afterEach(async () => {
    await removeWorkspace(workspace);
  });

  /** Applies the change the integrity fixture describes. */
  async function applyFixtureChange(): Promise<void> {
    const { rm, writeFile } = await import('node:fs/promises');
    await writeFile(
      path.join(server, 'resources', 'sf_core', 'server', 'main.lua'),
      await readFile(fixturePath('integrity-change', 'after', 'resources', 'sf_core', 'server', 'main.lua'), 'utf8'),
      'utf8',
    );
    await writeFile(
      path.join(server, 'resources', 'sf_core', 'server', 'extra.lua'),
      await readFile(fixturePath('integrity-change', 'after', 'resources', 'sf_core', 'server', 'extra.lua'), 'utf8'),
      'utf8',
    );
    await rm(path.join(server, 'resources', 'sf_core', 'client', 'legacy.lua'));
  }

  it('records a snapshot of every file with its hash', async () => {
    const result = await runCli(['integrity', 'snapshot', 'before', '--json'], workspace);
    const payload = parseJsonOutput<{ snapshot: { fileCount: number; snapshotHash: string } }>(result);
    expect(payload.snapshot.fileCount).toBeGreaterThan(0);
    expect(payload.snapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports added, modified and deleted files between two snapshots', async () => {
    await runCli(['integrity', 'snapshot', 'before'], workspace);
    await applyFixtureChange();
    await runCli(['integrity', 'snapshot', 'after'], workspace);

    const result = await runCli(['integrity', 'compare', 'before', 'after', '--json'], workspace);
    const payload = parseJsonOutput<{
      added: { path: string }[];
      modified: { path: string }[];
      deleted: { path: string }[];
      findings: { ruleId: string; severity: string }[];
    }>(result);

    expect(payload.added.map((change) => change.path)).toEqual(['resources/sf_core/server/extra.lua']);
    expect(payload.modified.map((change) => change.path)).toEqual(['resources/sf_core/server/main.lua']);
    expect(payload.deleted.map((change) => change.path)).toEqual(['resources/sf_core/client/legacy.lua']);
    expect(payload.findings[0]).toMatchObject({ ruleId: 'INT-CHANGE-001', severity: 'INFO' });
  });

  it('reports two identical snapshots as identical', async () => {
    await runCli(['integrity', 'snapshot', 'a'], workspace);
    await runCli(['integrity', 'snapshot', 'b'], workspace);

    const result = await runCli(['integrity', 'compare', 'a', 'b', '--json'], workspace);
    const payload = parseJsonOutput<{ identical: boolean; modified: unknown[] }>(result);
    expect(payload.identical).toBe(true);
    expect(payload.modified).toEqual([]);
  });

  it('never modifies a file it is tracking', async () => {
    const { readdir, stat } = await import('node:fs/promises');
    const before = await readdir(path.join(server, 'resources'), { recursive: true });
    const manifestBefore = await stat(path.join(server, 'resources', 'sf_core', 'fxmanifest.lua'));

    await runCli(['integrity', 'snapshot', 'a'], workspace);
    await runCli(['integrity', 'snapshot', 'b'], workspace);
    await runCli(['integrity', 'compare', 'a', 'b'], workspace);

    expect(await readdir(path.join(server, 'resources'), { recursive: true })).toEqual(before);
    expect((await stat(path.join(server, 'resources', 'sf_core', 'fxmanifest.lua'))).mtimeMs).toBe(manifestBefore.mtimeMs);
  });

  it('names the missing snapshot when a comparison cannot be made', async () => {
    await runCli(['integrity', 'snapshot', 'a'], workspace);
    const result = await runCli(['integrity', 'compare', 'a', 'nope'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('"nope"');
  });
});
