import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentinelSecurityError } from '../errors.js';
import { isPathInside, realPathOrNearest, resolveWithinRoot, toPosixPath, toRootRelative } from './paths.js';

describe('path containment', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'sentinel-paths-'));
    root = path.join(base, 'server');
    outside = path.join(base, 'outside');
    await mkdir(path.join(root, 'resources', 'sf_core'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(root, 'resources', 'sf_core', 'client.lua'), 'print("hello")', 'utf8');
    await writeFile(path.join(outside, 'secret.txt'), 'fixture content', 'utf8');
  });

  afterEach(async () => {
    await rm(path.dirname(root), { recursive: true, force: true });
  });

  it('resolves a legitimate relative path inside the root', () => {
    const resolved = resolveWithinRoot(root, 'resources/sf_core/client.lua');
    expect(isPathInside(root, resolved)).toBe(true);
  });

  it('accepts the root itself', () => {
    expect(isPathInside(root, root)).toBe(true);
    expect(() => resolveWithinRoot(root, '.')).not.toThrow();
  });

  it('rejects traversal out of the root', () => {
    expect(() => resolveWithinRoot(root, '../outside/secret.txt')).toThrow(SentinelSecurityError);
    expect(() => resolveWithinRoot(root, 'resources/../../outside/secret.txt')).toThrow(SentinelSecurityError);
  });

  it('rejects an absolute path outside the root', () => {
    expect(() => resolveWithinRoot(root, path.join(outside, 'secret.txt'))).toThrow(SentinelSecurityError);
  });

  it('rejects a path containing a NUL byte', () => {
    const withNul = `resources/sf_core${String.fromCharCode(0)}/client.lua`;
    expect(() => resolveWithinRoot(root, withNul)).toThrow(SentinelSecurityError);
  });

  it('rejects a symlink whose target escapes the root', async () => {
    const link = path.join(root, 'resources', 'escape');
    await symlink(outside, link, 'dir');
    // The lexical form stays inside the root, so only real-path resolution catches this.
    expect(isPathInside(root, link)).toBe(true);
    expect(() => resolveWithinRoot(root, 'resources/escape/secret.txt')).toThrow(SentinelSecurityError);
  });

  it('allows a symlink that stays inside the root', async () => {
    const link = path.join(root, 'resources', 'alias');
    await symlink(path.join(root, 'resources', 'sf_core'), link, 'dir');
    expect(() => resolveWithinRoot(root, 'resources/alias/client.lua')).not.toThrow();
  });

  it('resolves the nearest existing ancestor for a path that does not exist yet', () => {
    const resolved = realPathOrNearest(path.join(root, 'not', 'created', 'yet.txt'));
    expect(resolved.endsWith(path.join('not', 'created', 'yet.txt'))).toBe(true);
  });

  it('renders report paths as root-relative POSIX paths', () => {
    expect(toRootRelative(root, path.join(root, 'resources', 'sf_core', 'client.lua'))).toBe(
      'resources/sf_core/client.lua',
    );
    expect(toRootRelative(root, root)).toBe('.');
    expect(toPosixPath(path.join('a', 'b', 'c'))).toBe('a/b/c');
  });

  it('names the offending value in the security error', () => {
    try {
      resolveWithinRoot(root, '../outside/secret.txt', { label: 'manifest reference' });
      expect.unreachable('expected a security error');
    } catch (error) {
      expect(error).toBeInstanceOf(SentinelSecurityError);
      expect((error as SentinelSecurityError).message).toContain('manifest reference');
    }
  });
});
