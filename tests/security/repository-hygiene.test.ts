/**
 * Security: repository and product invariants.
 *
 * These tests encode commitments made in SECURITY.md and enforce them against
 * the source tree, so that a future change cannot quietly break them:
 *
 *   - no credentials are committed,
 *   - scanned code is never executed,
 *   - no outbound network access exists in the product,
 *   - the local database and dashboard are not exposed by default.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@sentinel-forge/core';
import { repositoryRoot } from '../helpers/workspace.js';

/**
 * High-signal patterns for a credential that has actually been committed.
 *
 * Deliberately narrower than the redaction patterns: redaction errs towards
 * masking anything credential-shaped, which is the right trade-off for output
 * but would flag ordinary identifiers here (`const token = argv[index]`).
 */
const COMMITTED_SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Discord webhook URL', pattern: /discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/[\w-]+\/[\w-]+/i },
  { name: 'PEM private key block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: 'JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: 'URI with embedded credentials', pattern: /[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s@"'/]{4,}@/i },
  {
    // The value must look like a credential, not merely sit after a
    // credential-shaped key. A short lowercase word is a label
    // (`PASSWORD: 'password'` in a display map), never a live secret.
    // Note the case-insensitive flag: a mixed-case test would be meaningless
    // here, so the signal is a digit, a symbol, or substantial length.
    name: 'quoted credential assignment',
    pattern:
      /\b\w*(?:password|api[_-]?key|secret|auth[_-]?token|licen[cs]e[_-]?key)\w*\s*(?:=|:)\s*["'`](?=[^"'`\n]*(?:[0-9]|[^\w\s"'`])|[^"'`\n]{16,}["'`])[^"'`\n]{8,}["'`]/i,
  },
];

/** A value is acceptable only when the surrounding line marks it as fictional. */
const PLACEHOLDER_MARKER = /EXAMPLE|FIXTURE|fixture|example|placeholder|Synthetic|synthetic/;

/**
 * A file-level notice, accepted in place of a per-line marker.
 *
 * A test for a credential detector needs values shaped like live credentials;
 * marking each one inline would both clutter the test and defeat it, since the
 * marker is itself a signal the detector reads. Declaring it once at the top of
 * the file is the honest alternative — and it must say so explicitly.
 */
const FILE_LEVEL_NOTICE = /Every value in this file is fabricated|SYNTHETIC FIXTURE/;

const SOURCE_DIRECTORIES = ['packages', 'apps', 'scripts', 'database'];

async function collectSourceFiles(): Promise<{ relativePath: string; content: string }[]> {
  const collected: { relativePath: string; content: string }[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        await walk(absolute);
        continue;
      }
      if (!/\.(ts|mjs|js|sql)$/.test(entry.name)) continue;
      collected.push({
        relativePath: path.relative(repositoryRoot, absolute).split(path.sep).join('/'),
        content: await readFile(absolute, 'utf8'),
      });
    }
  }

  for (const directory of SOURCE_DIRECTORIES) {
    await walk(path.join(repositoryRoot, directory));
  }
  return collected;
}

describe('committed-credential detection', () => {
  /** Applies the same matcher the hygiene check uses. */
  function flags(line: string): boolean {
    return COMMITTED_SECRET_PATTERNS.some(({ pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(line);
    });
  }

  it('flags a credential that looks live', () => {
    // Assembled rather than written out, for the same reason the product's own
    // fixtures are: nothing in this repository should read as a live secret.
    const join = (...parts: string[]): string => parts.join('');
    expect(flags(`local password = '${join('r4T#mQ', '9vLp2Wx')}'`)).toBe(true);
    expect(flags(`api_key = '${join('7Kd93MzQ', 'pXvR2NwL', '5tYbHcJ8')}'`)).toBe(true);
    expect(flags(join('mysql://user:', '8Jd2kQpV9mXr', '@db.invalid/schema'))).toBe(true);
    expect(
      flags(join('https://discord.com/api/', 'webhooks/', '473829104857392017/', 'hT2mQvXpL9dRfWs4KcYbNjE7uZaG3iOx')),
    ).toBe(true);
  });

  it('does not flag a label or an identifier that merely mentions a credential', () => {
    // These appear throughout the product's own source. A check that flags them
    // is a check nobody will keep running.
    expect(flags(`PASSWORD: 'password',`)).toBe(false);
    expect(flags(`const token = argv[index];`)).toBe(false);
    expect(flags(`description: 'API key assignment',`)).toBe(false);
    expect(flags(`secretKind: 'password'`)).toBe(false);
  });
});

describe('repository hygiene', () => {
  it('contains no committed credentials', async () => {
    const files = await collectSourceFiles();
    expect(files.length).toBeGreaterThan(20);

    for (const file of files) {
      // The redaction module contains the detection patterns themselves.
      if (file.relativePath.includes('redaction')) continue;

      for (const [index, line] of file.content.split('\n').entries()) {
        for (const { name, pattern } of COMMITTED_SECRET_PATTERNS) {
          const match = pattern.exec(line);
          pattern.lastIndex = 0;
          if (match === null) continue;
          // A credential-shaped value is only acceptable where it is
          // self-evidently fictional, so a real secret can never pass review as
          // test scaffolding.
          const fileHeader = file.content.split('\n').slice(0, 30).join('\n');
          expect(
            PLACEHOLDER_MARKER.test(line) || FILE_LEVEL_NOTICE.test(fileHeader),
            `${file.relativePath}:${String(index + 1)} contains an unmarked ${name}`,
          ).toBe(true);
        }
      }
    }
  });

  it('never executes scanned content', async () => {
    const files = await collectSourceFiles();
    const forbidden = [
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /child_process/,
      /\bexecSync\s*\(/,
      /\bspawnSync\s*\(/,
      /require\s*\(\s*[^'"`]/,
    ];

    for (const file of files) {
      if (!file.relativePath.endsWith('.ts')) continue;
      for (const pattern of forbidden) {
        expect(pattern.test(file.content), `${file.relativePath} matches ${String(pattern)}`).toBe(false);
      }
    }
  });

  it('makes no outbound network requests', async () => {
    const files = await collectSourceFiles();
    const networkApis = [/\bfetch\s*\(/, /node:https?['"]/, /\bnew\s+WebSocket\b/, /node:dgram/, /node:net['"]/];

    for (const file of files) {
      if (!file.relativePath.endsWith('.ts')) continue;
      for (const pattern of networkApis) {
        expect(pattern.test(file.content), `${file.relativePath} matches ${String(pattern)}`).toBe(false);
      }
    }
  });

  it('ships safe defaults: local-only, read-only, nothing enabled that phones home', () => {
    expect(DEFAULT_CONFIG.privacy).toEqual({ telemetry: false, network: false, ai: false });
    expect(DEFAULT_CONFIG.scan.followSymlinks).toBe(false);
    expect(DEFAULT_CONFIG.database.path.startsWith('.sentinel/')).toBe(true);
  });

  it('ignores local data and credential files in .gitignore', async () => {
    const ignore = await readFile(path.join(repositoryRoot, '.gitignore'), 'utf8');
    for (const entry of ['.sentinel/', '.env', '*.pem', '*.key', 'sentinel.db', 'node_modules/']) {
      expect(ignore, `${entry} must be ignored`).toContain(entry);
    }
  });

  it('keeps every SQL migration free of raw secret columns', async () => {
    const files = await collectSourceFiles();
    const migrations = files.filter((file) => file.relativePath.startsWith('database/migrations/'));
    expect(migrations.length).toBeGreaterThan(0);

    for (const migration of migrations) {
      // Columns that hold analysis excerpts must be named as redacted, so that
      // the storage contract is visible at the schema level.
      const excerptColumns = migration.content.match(/^\s*(\w*excerpt\w*)\s+TEXT/gim) ?? [];
      for (const column of excerptColumns) {
        expect(column.toLowerCase()).toContain('redacted');
      }
    }
  });
});
