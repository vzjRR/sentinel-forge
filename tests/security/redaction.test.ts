/**
 * Security: no secret leaves the machine in readable form.
 *
 * The security-indicators fixture contains fictional credential-shaped values.
 * These tests take that fixture through the paths a real secret would travel —
 * evidence, findings, logs and errors — and assert the value never survives.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { SentinelUserError, createFinding, createLogger, redactText, redactValue } from '@sentinel-forge/core';
import { fixturePath } from '../helpers/workspace.js';

/** Values planted in the fixture. None of them is a real credential. */
const FIXTURE_SECRETS = [
  'EXAMPLE_FIXTURE_TOKEN_NOT_REAL',
  'EXAMPLE_FIXTURE_API_KEY_0000000000000000',
  'EXAMPLE_NOT_A_REAL_PASSWORD',
];

async function readFixtureFiles(): Promise<{ path: string; content: string }[]> {
  const root = fixturePath('security-indicators');
  const files: { path: string; content: string }[] = [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    files.push({ path: absolute, content: await readFile(absolute, 'utf8') });
  }
  return files;
}

describe('secret redaction across output paths', () => {
  it('the fixture really does contain the values under test', async () => {
    const files = await readFixtureFiles();
    const combined = files.map((file) => file.content).join('\n');
    for (const secret of FIXTURE_SECRETS) {
      expect(combined, `${secret} must be present in the fixture`).toContain(secret);
    }
  });

  it('redacts every planted value when fixture content is rendered', async () => {
    for (const file of await readFixtureFiles()) {
      const redacted = redactText(file.content);
      for (const secret of FIXTURE_SECRETS) {
        expect(redacted, `${file.path} still contains ${secret}`).not.toContain(secret);
      }
    }
  });

  it('redacts values carried in evidence excerpts of a finding', async () => {
    const serverLua = await readFile(fixturePath('security-indicators', 'resources', 'sf_suspicious', 'server.lua'), 'utf8');
    const finding = createFinding({
      ruleId: 'SEC-SECRET-001',
      severity: 'HIGH',
      confidence: 0.9,
      title: 'Embedded credential indicator',
      summary: 'A credential-shaped value was detected in a resource file.',
      recommendation: 'Move the value into server configuration outside the resource, and rotate it.',
      evidence: [
        {
          kind: 'FILE_REFERENCE',
          description: 'Credential-shaped assignment.',
          location: { file: 'resources/sf_suspicious/server.lua', line: 5 },
          excerpt: serverLua,
        },
      ],
      resource: 'sf_suspicious',
      file: 'resources/sf_suspicious/server.lua',
      line: 5,
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    const serialized = JSON.stringify(finding);
    for (const secret of FIXTURE_SECRETS) {
      expect(serialized).not.toContain(secret);
    }
    // The location survives redaction: the finding must stay actionable.
    expect(serialized).toContain('resources/sf_suspicious/server.lua');
  });

  it('redacts values written to the log, in both formats', async () => {
    const serverLua = await readFile(fixturePath('security-indicators', 'resources', 'sf_suspicious', 'server.lua'), 'utf8');
    for (const format of ['pretty', 'json'] as const) {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer | string, _encoding, callback): void {
          chunks.push(chunk.toString());
          callback();
        },
      });
      const logger = createLogger({ stream, format, level: 'DEBUG' });
      logger.error('Analysis failed while reading resource.', { excerpt: serverLua, resource: 'sf_suspicious' });

      const written = chunks.join('');
      for (const secret of FIXTURE_SECRETS) {
        expect(written, `${format} log leaked ${secret}`).not.toContain(secret);
      }
    }
  });

  it('redacts values that reach an error message', () => {
    const error = new SentinelUserError(
      `Failed to parse mysql://fixture_user:EXAMPLE_NOT_A_REAL_PASSWORD@127.0.0.1/db`,
    );
    expect(error.message).not.toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
    expect(JSON.stringify(error.toJSON())).not.toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
  });

  it('redacts the connection string in the fixture server.cfg', async () => {
    const cfg = await readFile(fixturePath('security-indicators', 'server.cfg'), 'utf8');
    expect(cfg).toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
    expect(redactText(cfg)).not.toContain('EXAMPLE_NOT_A_REAL_PASSWORD');
  });

  it('redacts nested structures headed for a JSON report', () => {
    const payload = redactValue({
      server: { configuration: { mysql_connection_string: 'mysql://u:EXAMPLE_NOT_A_REAL_PASSWORD@127.0.0.1/db' } },
      findings: [{ excerpt: `local api_key = 'EXAMPLE_FIXTURE_API_KEY_0000000000000000'` }],
    });
    const serialized = JSON.stringify(payload);
    for (const secret of FIXTURE_SECRETS) {
      expect(serialized).not.toContain(secret);
    }
  });
});
