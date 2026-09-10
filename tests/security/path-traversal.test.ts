/**
 * Security: path containment.
 *
 * Path input reaches Sentinel Forge from untrusted content — manifest
 * declarations, configuration values, file names inside a downloaded resource.
 * These tests assert that none of it can reach outside the directory the
 * operator pointed the tool at.
 */

import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentinelSecurityError, readTextFileBounded, resolveWithinRoot, walkDirectory } from '@sentinel-forge/core';
import { createWorkspace, removeWorkspace } from '../helpers/workspace.js';

describe('path traversal defence', () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    base = await createWorkspace('sentinel-traversal-');
    root = path.join(base, 'server');
    outside = path.join(base, 'outside');
    await mkdir(path.join(root, 'resources', 'sf_core'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.txt'), 'FIXTURE_OUT_OF_BOUNDS_CONTENT', 'utf8');
    await writeFile(path.join(root, 'resources', 'sf_core', 'client.lua'), 'print("hi")', 'utf8');
  });

  afterEach(async () => {
    await removeWorkspace(base);
  });

  it('rejects every traversal shape a manifest could declare', () => {
    const hostile = [
      '../outside/secret.txt',
      '../../outside/secret.txt',
      'resources/../../outside/secret.txt',
      './resources/sf_core/../../../outside/secret.txt',
      'resources/sf_core/../../..',
      path.join('..', '..', '..', '..', 'etc', 'passwd'),
    ];
    for (const candidate of hostile) {
      expect(() => resolveWithinRoot(root, candidate), candidate).toThrow(SentinelSecurityError);
    }
  });

  it('rejects an absolute path, even one that exists', () => {
    expect(() => resolveWithinRoot(root, path.join(outside, 'secret.txt'))).toThrow(SentinelSecurityError);
    expect(() => resolveWithinRoot(root, path.sep)).toThrow(SentinelSecurityError);
  });

  it('rejects a NUL byte, which can truncate a path in a native call', () => {
    const withNul = `resources/sf_core${String.fromCharCode(0)}/../../outside/secret.txt`;
    expect(() => resolveWithinRoot(root, withNul)).toThrow(SentinelSecurityError);
  });

  it('rejects a file symlink pointing outside the root', async () => {
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'resources', 'sf_core', 'linked.lua'));
    expect(() => resolveWithinRoot(root, 'resources/sf_core/linked.lua')).toThrow(SentinelSecurityError);
    await expect(readTextFileBounded('resources/sf_core/linked.lua', { root })).rejects.toBeInstanceOf(
      SentinelSecurityError,
    );
  });

  it('rejects a directory symlink pointing outside the root', async () => {
    await symlink(outside, path.join(root, 'resources', 'escape'), 'dir');
    expect(() => resolveWithinRoot(root, 'resources/escape/secret.txt')).toThrow(SentinelSecurityError);
  });

  it('rejects a symlink chain that eventually leaves the root', async () => {
    await symlink(outside, path.join(base, 'hop'), 'dir');
    await symlink(path.join(base, 'hop'), path.join(root, 'resources', 'escape'), 'dir');
    expect(() => resolveWithinRoot(root, 'resources/escape/secret.txt')).toThrow(SentinelSecurityError);
  });

  it('never reads out-of-bounds content during a traversal', async () => {
    await symlink(outside, path.join(root, 'resources', 'escape'), 'dir');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'linked.txt'));

    const result = await walkDirectory(root);
    for (const file of result.files) {
      expect(file.absolutePath.startsWith(path.join(base, 'server'))).toBe(true);
      expect(file.relativePath.startsWith('..')).toBe(false);
    }
    expect(result.files.some((file) => file.relativePath.includes('secret'))).toBe(false);
  });

  it('reports a security failure rather than degrading to a partial read', () => {
    try {
      resolveWithinRoot(root, '../outside/secret.txt');
      expect.unreachable('resolveWithinRoot must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SentinelSecurityError);
      // Exit code 4 is the documented "security-sensitive failure" code.
      expect((error as SentinelSecurityError).exitCode).toBe(4);
    }
  });

  it('does not leak out-of-bounds content into the error message', async () => {
    try {
      await readTextFileBounded('../outside/secret.txt', { root });
      expect.unreachable('readTextFileBounded must throw');
    } catch (error) {
      expect(String(error)).not.toContain('FIXTURE_OUT_OF_BOUNDS_CONTENT');
    }
  });
});
