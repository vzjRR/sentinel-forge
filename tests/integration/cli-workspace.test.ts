/**
 * Integration: workspace lifecycle.
 *
 * Exercises the path a real operator takes on first use — init, doctor, and the
 * on-disk artefacts those commands produce — across the configuration loader,
 * the filesystem layer and the SQLite layer together.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAppliedMigrations, listMigrations, openDatabase } from '@sentinel-forge/core';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { createWorkspace, parseJsonOutput, removeWorkspace, runCli } from '../helpers/workspace.js';

describe('workspace lifecycle', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await createWorkspace('sentinel-lifecycle-');
  });

  afterEach(async () => {
    await removeWorkspace(workspace);
  });

  it('creates a valid configuration file that the loader accepts unchanged', async () => {
    const result = await runCli(['init', '--json'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);

    const configPath = path.join(workspace, 'sentinel.config.json');
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    expect(raw['privacy']).toEqual({ telemetry: false, network: false, ai: false });
    expect(raw['server']).toMatchObject({ path: null });

    const doctor = await runCli(['doctor', '--json'], workspace);
    const payload = parseJsonOutput<{ summary: { failed: number } }>(doctor);
    expect(payload.summary.failed).toBe(0);
  });

  it('creates a migrated database and the reports directory', async () => {
    await runCli(['init'], workspace);

    const databasePath = path.join(workspace, '.sentinel', 'sentinel.db');
    expect((await stat(databasePath)).isFile()).toBe(true);
    expect((await stat(path.join(workspace, '.sentinel', 'reports'))).isDirectory()).toBe(true);

    const database = openDatabase({ location: databasePath });
    try {
      // Every migration shipped with the build is applied on init, and each is
      // recorded with the checksum of the SQL that ran.
      const applied = listAppliedMigrations(database.driver);
      expect(applied.map((entry) => entry.version)).toEqual(
        listMigrations().map((migration) => migration.version),
      );
      expect(applied.every((entry) => /^[0-9a-f]{64}$/.test(entry.checksum))).toBe(true);
    } finally {
      database.close();
    }
  });

  it('records a server row that cascades on delete, which is what purge will rely on', async () => {
    await runCli(['init'], workspace);
    const database = openDatabase({ location: path.join(workspace, '.sentinel', 'sentinel.db') });
    try {
      const { driver } = database;
      const now = new Date().toISOString();
      driver.transaction(() => {
        driver
          .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
          .run('srv_1', '/opt/fxserver', 'fingerprint', now, now);
        driver
          .prepare(
            'INSERT INTO resources (id, server_id, name, path, manifest_kind, file_count, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run('res_1', 'srv_1', 'sf_core', 'resources/sf_core', 'fxmanifest', 3, now, now);
      });

      driver.prepare('DELETE FROM servers WHERE id = ?').run('srv_1');
      const remaining = driver.prepare('SELECT COUNT(*) AS count FROM resources').get<{ count: number }>();
      expect(remaining?.count).toBe(0);
    } finally {
      database.close();
    }
  });

  it('rejects an invalid configuration before any command runs', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      path.join(workspace, 'sentinel.config.json'),
      JSON.stringify({ scan: { maxDepth: 0 }, privacy: { network: true } }),
      'utf8',
    );

    const result = await runCli(['doctor', '--json'], workspace);
    const payload = parseJsonOutput<{ checks: { name: string; status: string; detail: string }[] }>(result);
    const configurationCheck = payload.checks.find((check) => check.name === 'Configuration');
    expect(configurationCheck?.status).toBe('FAIL');
    expect(configurationCheck?.detail).toContain('scan.maxDepth');
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
  });

  it('does not write anything outside the working directory', async () => {
    await runCli(['init'], workspace);
    const entries = await (await import('node:fs/promises')).readdir(workspace);
    expect(entries.sort()).toEqual(['.sentinel', 'sentinel.config.json']);
  });
});
