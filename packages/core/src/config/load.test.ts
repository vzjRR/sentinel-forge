import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentinelConfigError } from '../errors.js';
import { findConfigFile, loadConfig, resolveConfiguredPath } from './load.js';

describe('configuration loading', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'sentinel-config-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('falls back to defaults when no configuration file exists', async () => {
    const loaded = await loadConfig({ cwd: workspace });
    expect(loaded.sourcePath).toBeNull();
    expect(loaded.config.server.path).toBeNull();
    expect(loaded.baseDirectory).toBe(workspace);
  });

  it('finds the nearest configuration file by walking upwards', async () => {
    await writeFile(path.join(workspace, 'sentinel.config.json'), JSON.stringify({ scan: { maxDepth: 5 } }), 'utf8');
    const nested = path.join(workspace, 'a', 'b');
    await mkdir(nested, { recursive: true });

    const found = await findConfigFile(nested);
    expect(found).toBe(path.join(workspace, 'sentinel.config.json'));

    const loaded = await loadConfig({ cwd: nested });
    expect(loaded.config.scan.maxDepth).toBe(5);
    // Relative paths resolve against the file's directory, not the cwd.
    expect(loaded.baseDirectory).toBe(workspace);
  });

  it('applies caller overrides above the file contents', async () => {
    await writeFile(
      path.join(workspace, 'sentinel.config.json'),
      JSON.stringify({ server: { path: '/from/file' }, logging: { level: 'INFO' } }),
      'utf8',
    );
    const loaded = await loadConfig({
      cwd: workspace,
      overrides: { server: { path: '/from/flag' }, logging: { level: 'DEBUG' } },
    });
    expect(loaded.config.server.path).toBe('/from/flag');
    expect(loaded.config.logging.level).toBe('DEBUG');
  });

  it('reports an explicit configuration path that does not exist', async () => {
    await expect(loadConfig({ cwd: workspace, configPath: 'missing.json' })).rejects.toBeInstanceOf(
      SentinelConfigError,
    );
  });

  it('reports invalid JSON with an actionable message', async () => {
    await writeFile(path.join(workspace, 'sentinel.config.json'), '{ "scan": { ', 'utf8');
    await expect(loadConfig({ cwd: workspace })).rejects.toThrow(/not valid JSON/);
  });

  it('reports every validation issue in the thrown message', async () => {
    await writeFile(
      path.join(workspace, 'sentinel.config.json'),
      JSON.stringify({ scan: { maxDepth: 0 }, logging: { level: 'TRACE' } }),
      'utf8',
    );
    await expect(loadConfig({ cwd: workspace })).rejects.toThrow(/scan.maxDepth[\s\S]*logging.level/);
  });

  it('skips file discovery when reading is disabled', async () => {
    await writeFile(path.join(workspace, 'sentinel.config.json'), JSON.stringify({ scan: { maxDepth: 5 } }), 'utf8');
    const loaded = await loadConfig({ cwd: workspace, readFile: false });
    expect(loaded.sourcePath).toBeNull();
    expect(loaded.config.scan.maxDepth).toBe(24);
  });

  it('resolves configured relative paths against the configuration directory', async () => {
    await writeFile(path.join(workspace, 'sentinel.config.json'), '{}', 'utf8');
    const loaded = await loadConfig({ cwd: workspace });
    expect(resolveConfiguredPath(loaded, '.sentinel/sentinel.db')).toBe(
      path.join(workspace, '.sentinel', 'sentinel.db'),
    );
    expect(resolveConfiguredPath(loaded, path.join(path.sep, 'absolute', 'path'))).toBe(
      path.join(path.sep, 'absolute', 'path'),
    );
  });
});
