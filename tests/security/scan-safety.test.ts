/**
 * Security: scanning untrusted server content.
 *
 * A scanned server is written by third parties. These tests point the real scan
 * pipeline at hostile content and assert that it stays inside the root, never
 * executes anything, never leaks a secret into output, and never crashes.
 */

import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanServer } from '@sentinel-forge/scanner';
import { createWorkspace, fixturePath, removeWorkspace } from '../helpers/workspace.js';

const BASE_OPTIONS = {
  resourceDirectories: ['resources'] as const,
  minimumSeverity: 'INFO' as const,
  disabledRules: [] as const,
  command: 'scan',
};

async function writeResource(root: string, name: string, manifest: string, files: Record<string, string> = {}): Promise<void> {
  const directory = path.join(root, 'resources', name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'fxmanifest.lua'), manifest, 'utf8');
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

describe('scanning hostile content', () => {
  let base: string;
  let server: string;
  let outside: string;

  beforeEach(async () => {
    base = await createWorkspace('sentinel-scan-safety-');
    server = path.join(base, 'server');
    outside = path.join(base, 'outside');
    await mkdir(path.join(server, 'resources'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.txt'), 'FIXTURE_OUT_OF_BOUNDS_CONTENT', 'utf8');
    await writeFile(path.join(server, 'server.cfg'), 'ensure sf_hostile\n', 'utf8');
  });

  afterEach(async () => {
    await removeWorkspace(base);
  });

  it('does not read a file a manifest points at outside the server root', async () => {
    await writeResource(
      server,
      'sf_hostile',
      ["fx_version 'cerulean'", "game 'gta5'", "client_script '../../outside/secret.txt'"].join('\n'),
    );

    const result = await scanServer({ ...BASE_OPTIONS, serverPath: server });
    const serialized = JSON.stringify(result.report);

    expect(serialized).not.toContain('FIXTURE_OUT_OF_BOUNDS_CONTENT');
    // The traversal declaration is still reported: it matches no file inside the
    // resource, which is exactly what the operator needs to know.
    expect(result.report.findings.some((finding) => finding.ruleId === 'CFG-MISSING-FILE-001')).toBe(true);
  });

  it('does not follow a symlink out of the server root during discovery', async () => {
    await writeResource(server, 'sf_hostile', ["fx_version 'cerulean'", "game 'gta5'"].join('\n'));
    await symlink(outside, path.join(server, 'resources', 'sf_hostile', 'escape'), 'dir');

    const result = await scanServer({ ...BASE_OPTIONS, serverPath: server });
    const files = result.server.resources.flatMap((resource) => resource.files.map((file) => file.path));

    expect(files.some((file) => file.includes('secret'))).toBe(false);
    expect(result.server.limitations.some((limitation) => limitation.reason.includes('Symbolic link'))).toBe(true);
  });

  it('never emits an absolute host path for a resource file', async () => {
    await writeResource(server, 'sf_hostile', ["fx_version 'cerulean'", "game 'gta5'", "client_script 'missing.lua'"].join('\n'));

    const result = await scanServer({ ...BASE_OPTIONS, serverPath: server });
    for (const finding of result.report.findings) {
      expect(finding.file ?? '').not.toContain(base);
      for (const evidence of finding.evidence) {
        expect(evidence.location?.file ?? '').not.toContain(base);
      }
    }
    // The server path itself is the operator's own input and is reported as given.
    expect(result.report.server.path).toBe(server);
  });

  it('redacts a credential that appears in a manifest declaration', async () => {
    await writeResource(
      server,
      'sf_hostile',
      [
        "fx_version 'cerulean'",
        "game 'gta5'",
        "description 'api_key = EXAMPLE_FIXTURE_API_KEY_0000000000'",
        "client_script 'https://discord.com/api/webhooks/000000000000000000/EXAMPLE_FIXTURE_TOKEN'",
      ].join('\n'),
    );

    const result = await scanServer({ ...BASE_OPTIONS, serverPath: server });
    const serialized = JSON.stringify(result.report);
    expect(serialized).not.toContain('EXAMPLE_FIXTURE_API_KEY_0000000000');
    expect(serialized).not.toContain('EXAMPLE_FIXTURE_TOKEN');
  });

  it('survives hostile resource and file names', async () => {
    for (const name of ['sf-dash', 'sf.dot', 'sf space', 'sf_юникод']) {
      await writeResource(server, name, ["fx_version 'cerulean'", "game 'gta5'"].join('\n'));
    }
    const result = await scanServer({ ...BASE_OPTIONS, serverPath: server });
    expect(result.server.resources.length).toBeGreaterThanOrEqual(4);
  });

  it('survives a manifest of pathological size and shape', async () => {
    const pathological = [
      "fx_version 'cerulean'",
      "game 'gta5'",
      `client_scripts { ${Array.from({ length: 5000 }, (_v, index) => `'file${String(index)}.lua'`).join(', ')} }`,
      '{'.repeat(2000),
      "description 'unterminated",
    ].join('\n');
    await writeResource(server, 'sf_hostile', pathological);

    const started = performance.now();
    const result = await scanServer({ ...BASE_OPTIONS, serverPath: server });
    expect(performance.now() - started).toBeLessThan(30_000);
    expect(result.report.findings.length).toBeGreaterThan(0);
  });

  it('reports a resource directory that is empty apart from hostile content, without failing the scan', async () => {
    await mkdir(path.join(server, 'resources', 'sf_empty'), { recursive: true });
    await writeFile(path.join(server, 'resources', 'sf_empty', 'payload.bin'), Buffer.from([0, 255, 0, 1]));
    await writeResource(server, 'sf_ok', ["fx_version 'cerulean'", "game 'gta5'"].join('\n'));

    const result = await scanServer({ ...BASE_OPTIONS, serverPath: server });
    expect(result.server.resources.map((resource) => resource.name).sort()).toEqual(['sf_empty', 'sf_ok']);
    expect(result.report.findings.some((finding) => finding.ruleId === 'CFG-MANIFEST-001')).toBe(true);
  });

  it('leaves the scanned server untouched', async () => {
    await writeResource(server, 'sf_hostile', ["fx_version 'cerulean'", "game 'gta5'"].join('\n'), {
      'client.lua': 'print("x")',
    });

    const { readdir, stat } = await import('node:fs/promises');
    const before = await readdir(path.join(server, 'resources', 'sf_hostile'));
    const beforeStat = await stat(path.join(server, 'resources', 'sf_hostile', 'client.lua'));

    await scanServer({ ...BASE_OPTIONS, serverPath: server });

    expect(await readdir(path.join(server, 'resources', 'sf_hostile'))).toEqual(before);
    const afterStat = await stat(path.join(server, 'resources', 'sf_hostile', 'client.lua'));
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    expect(afterStat.size).toBe(beforeStat.size);
  });

  it('does not leak the planted fixture credentials when scanning the security fixture', async () => {
    const result = await scanServer({ ...BASE_OPTIONS, serverPath: fixturePath('security-indicators') });
    const serialized = JSON.stringify(result.report);
    for (const secret of [
      'EXAMPLE_FIXTURE_TOKEN_NOT_REAL',
      'EXAMPLE_FIXTURE_API_KEY_0000000000000000',
      'EXAMPLE_NOT_A_REAL_PASSWORD',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });
});
