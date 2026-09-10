import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { walkDirectory } from './walk.js';

describe('bounded directory traversal', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'sentinel-walk-'));
    root = path.join(base, 'server');
    outside = path.join(base, 'outside');
    await mkdir(path.join(root, 'resources', 'sf_core'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'left-over'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(root, 'server.cfg'), 'sv_maxclients 32', 'utf8');
    await writeFile(path.join(root, 'resources', 'sf_core', 'fxmanifest.lua'), "fx_version 'cerulean'", 'utf8');
    await writeFile(path.join(root, 'resources', 'sf_core', 'client.lua'), 'print("hi")', 'utf8');
    await writeFile(path.join(root, 'node_modules', 'left-over', 'index.js'), 'module.exports = {}', 'utf8');
    await writeFile(path.join(outside, 'secret.txt'), 'fixture content', 'utf8');
  });

  afterEach(async () => {
    await rm(path.dirname(root), { recursive: true, force: true });
  });

  it('returns regular files with root-relative POSIX paths', async () => {
    const result = await walkDirectory(root);
    const paths = result.files.map((file) => file.relativePath).sort();
    expect(paths).toEqual(['resources/sf_core/client.lua', 'resources/sf_core/fxmanifest.lua', 'server.cfg']);
    expect(result.stopReason).toBe('COMPLETED');
  });

  it('skips directories that carry no diagnostic value', async () => {
    const result = await walkDirectory(root);
    expect(result.files.some((file) => file.relativePath.includes('node_modules'))).toBe(false);
  });

  it('records file size and modification time', async () => {
    const result = await walkDirectory(root);
    const manifest = result.files.find((file) => file.relativePath.endsWith('fxmanifest.lua'));
    expect(manifest?.size).toBeGreaterThan(0);
    expect(manifest?.modifiedAt).toBeInstanceOf(Date);
  });

  it('does not follow symlinks by default, and says why each entry was skipped', async () => {
    await symlink(outside, path.join(root, 'resources', 'escape'), 'dir');
    const result = await walkDirectory(root);
    expect(result.files.some((file) => file.relativePath.includes('secret.txt'))).toBe(false);
    expect(result.skipped.some((entry) => entry.reason.includes('Symbolic link'))).toBe(true);
  });

  it('stops at the entry limit and reports that the walk was truncated', async () => {
    const result = await walkDirectory(root, { maxEntries: 1 });
    expect(result.files).toHaveLength(1);
    expect(result.stopReason).toBe('MAX_ENTRIES_REACHED');
  });

  it('stops descending at the depth limit and records the skipped directories', async () => {
    const result = await walkDirectory(root, { maxDepth: 1 });
    expect(result.files.map((file) => file.relativePath)).toEqual(['server.cfg']);
    expect(result.skipped.some((entry) => entry.reason.includes('depth'))).toBe(true);
  });

  it('replaces, rather than extends, the default skip list when one is supplied', async () => {
    const result = await walkDirectory(root, { skipDirectories: ['resources'] });
    const paths = result.files.map((file) => file.relativePath).sort();
    // `resources` is now skipped; `node_modules` is no longer skipped, because a
    // caller-supplied list is the complete list.
    expect(paths).toEqual(['node_modules/left-over/index.js', 'server.cfg']);
  });

  it('reports an empty result for a directory that does not exist rather than throwing', async () => {
    const result = await walkDirectory(path.join(root, 'not-there'));
    expect(result.files).toEqual([]);
    expect(result.skipped[0]?.reason).toContain('could not be read');
  });
});
