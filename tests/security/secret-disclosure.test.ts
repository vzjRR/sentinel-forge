/**
 * Security: a credential detector must not become a credential channel.
 *
 * Sentinel Forge reads other people's servers and finds credentials in them.
 * The single most damaging defect this product could have is copying one of
 * those values into a report, a log line, a database row, or a terminal.
 *
 * These tests run the real pipeline over a fixture containing realistically
 * shaped fabricated credentials, and assert that not one of them survives into
 * any output path.
 */

import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type OpenedDatabase } from '@sentinel-forge/core';
import { allFabricatedSecrets, fabricatedLeakyResource } from '../helpers/fabricated-credentials.js';
import { createWorkspace, fixturePath, removeWorkspace, runCli } from '../helpers/workspace.js';

/**
 * Every credential-shaped value the test server contains.
 *
 * Two sources, because both paths matter: the committed fixture's explicitly
 * marked placeholders, and the realistically shaped values generated into the
 * server at test time. Reading the fixture rather than listing values here
 * means a value added to it cannot be forgotten.
 */
async function plantedSecrets(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const values: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Resource files only. fixture.json describes the fixture in prose, and
    // treating its words as secrets would make these tests assert nonsense.
    if (!/\.(?:lua|cfg)$/.test(entry.name)) continue;
    const content = await readFile(path.join(entry.parentPath, entry.name), 'utf8');

    for (const match of content.matchAll(/['"]([A-Za-z0-9_\-+/=.#]{16,})['"]/g)) {
      const value = match[1];
      if (value === undefined) continue;
      // A credential has a digit and no path structure. This keeps ordinary
      // strings — paths, URLs, descriptions — out of the assertion.
      if (value.startsWith('http') || value.includes('/') || !/\d/.test(value)) continue;
      values.push(value);
    }
    for (const match of content.matchAll(/webhooks\/\d+\/([A-Za-z0-9_-]{16,})/g)) {
      if (match[1] !== undefined) values.push(match[1]);
    }
    for (const match of content.matchAll(/:\/\/[^\s:]+:([^\s@]{6,})@/g)) {
      if (match[1] !== undefined) values.push(match[1]);
    }
  }

  return [...new Set([...values, ...allFabricatedSecrets()])];
}

describe('secret disclosure', () => {
  let workspace: string;
  let server: string;

  beforeEach(async () => {
    workspace = await createWorkspace('sentinel-disclosure-');
    server = path.join(workspace, 'server');

    // The committed fixture holds only explicitly marked placeholders. The
    // realistically shaped values are generated here, so that nothing in the
    // repository reads as a live credential.
    await cp(fixturePath('security-indicators'), server, { recursive: true });
    const leaky = path.join(server, 'resources', 'sf_leaky');
    await mkdir(leaky, { recursive: true });
    for (const [name, content] of Object.entries(fabricatedLeakyResource())) {
      await writeFile(path.join(leaky, name), content, 'utf8');
    }

    await runCli(['init', '--server', server], workspace);
  });

  afterEach(async () => {
    await removeWorkspace(workspace);
  });

  it('plants credential-shaped values that the detector actually finds', async () => {
    // Guards the tests below: if the fixture stopped containing secrets, or the
    // detector stopped finding them, "no leak" would become vacuously true.
    const secrets = await plantedSecrets(server);
    expect(secrets.length).toBeGreaterThanOrEqual(4);

    const result = await runCli(['security', '--json'], workspace);
    const payload = JSON.parse(result.stdout) as { findings: { ruleId: string; confidence: number }[] };
    const credentialFindings = payload.findings.filter(
      (finding) => finding.ruleId === 'SEC-SECRET-001' || finding.ruleId === 'SEC-WEBHOOK-001',
    );
    expect(credentialFindings.length).toBeGreaterThanOrEqual(4);
    expect(credentialFindings.some((finding) => finding.confidence >= 0.8)).toBe(true);
  });

  it('leaks no planted value into the security command output', async () => {
    const secrets = await plantedSecrets(server);
    for (const stream of [
      (await runCli(['security'], workspace)).stdout,
      (await runCli(['security', '--json'], workspace)).stdout,
      (await runCli(['security', '--verbose'], workspace)).stderr,
    ]) {
      for (const secret of secrets) {
        expect(stream, `output contained ${secret.slice(0, 8)}…`).not.toContain(secret);
      }
    }
  });

  it('leaks no planted value into a JSON or Markdown report', async () => {
    const secrets = await plantedSecrets(server);
    for (const format of ['json', 'markdown']) {
      const result = await runCli(['report', '--format', format], workspace);
      for (const secret of secrets) {
        expect(result.stdout, `${format} report contained ${secret.slice(0, 8)}…`).not.toContain(secret);
      }
    }
  });

  it('leaks no planted value into the local database', async () => {
    await runCli(['scan'], workspace);

    let database: OpenedDatabase | undefined;
    try {
      database = openDatabase({ location: path.join(workspace, '.sentinel', 'sentinel.db') });
      const tables = database.driver
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all<{ name: string }>();

      const secrets = await plantedSecrets(server);
      for (const { name } of tables) {
        if (name.startsWith('sqlite_')) continue;
        const rows = database.driver.prepare(`SELECT * FROM ${name}`).all();
        const serialized = JSON.stringify(rows);
        for (const secret of secrets) {
          expect(serialized, `${name} contained ${secret.slice(0, 8)}…`).not.toContain(secret);
        }
      }
    } finally {
      database?.close();
    }
  });

  it('leaks no planted value into a baseline or an integrity snapshot', async () => {
    await runCli(['baseline', 'create', 'before'], workspace);
    await runCli(['integrity', 'snapshot', 'before'], workspace);

    const secrets = await plantedSecrets(server);
    for (const argv of [
      ['baseline', 'show', 'before', '--json'],
      ['integrity', 'list', '--json'],
    ]) {
      const result = await runCli(argv, workspace);
      for (const secret of secrets) {
        expect(result.stdout, `${argv.join(' ')} contained ${secret.slice(0, 8)}…`).not.toContain(secret);
      }
    }
  });

  it('still reports where each credential is, so the finding stays actionable', async () => {
    const result = await runCli(['security', '--json'], workspace);
    const payload = JSON.parse(result.stdout) as { findings: { ruleId: string; file?: string; line?: number }[] };
    const credential = payload.findings.find((finding) => finding.ruleId === 'SEC-SECRET-001');

    expect(credential?.file).toContain('resources/');
    expect(credential?.line).toBeGreaterThan(0);
  });

  it('prints the standing limitation with every security run', async () => {
    const result = await runCli(['security'], workspace);
    expect(result.stdout).toContain('do not guarantee malware detection');
    expect(result.stdout).toContain('Absence of a finding is not evidence of safety');
  });

  it('never describes a finding as malicious', async () => {
    // Security findings are indicators. Wording that implies intent would be a
    // claim the evidence cannot support.
    const result = await runCli(['security'], workspace);
    expect(result.stdout).not.toMatch(/\bmalicious\b|\bbackdoor\b|\bmalware detected\b|\bcompromised\b/i);
  });

  it('describes obfuscation as blocking review, not as wrongdoing', async () => {
    const result = await runCli(['security', '--json'], workspace);
    const payload = JSON.parse(result.stdout) as { findings: { ruleId: string; summary: string }[] };
    const obfuscation = payload.findings.find((finding) => finding.ruleId === 'SEC-OBFUSCATION-001');

    expect(obfuscation?.summary).toContain('cannot be reviewed');
    expect(obfuscation?.summary).toContain('not in itself evidence of wrongdoing');
  });
});
