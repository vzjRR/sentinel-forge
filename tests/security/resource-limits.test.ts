/**
 * Security: resource exhaustion.
 *
 * A scanner is pointed at content it does not control. Anything unbounded —
 * file size, directory depth, entry count, symlink cycles — is a denial of
 * service against the machine running the scan.
 */

import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentinelUserError, readTextFileBounded, walkDirectory } from '@sentinel-forge/core';
import { createWorkspace, removeWorkspace } from '../helpers/workspace.js';

describe('resource limits', () => {
  let root: string;

  beforeEach(async () => {
    root = await createWorkspace('sentinel-limits-');
  });

  afterEach(async () => {
    await removeWorkspace(root);
  });

  it('refuses a file larger than the configured limit', async () => {
    await writeFile(path.join(root, 'huge.lua'), 'a'.repeat(2 * 1024 * 1024), 'utf8');
    await expect(readTextFileBounded('huge.lua', { root, maxBytes: 64 * 1024 })).rejects.toBeInstanceOf(
      SentinelUserError,
    );
  });

  it('caps memory use when a caller opts into truncation', async () => {
    await writeFile(path.join(root, 'huge.lua'), 'a'.repeat(2 * 1024 * 1024), 'utf8');
    const result = await readTextFileBounded('huge.lua', { root, maxBytes: 64 * 1024, truncate: true });
    expect(result.content.length).toBe(64 * 1024);
    expect(result.truncated).toBe(true);
  });

  it('terminates on a symlink cycle instead of looping forever', async () => {
    const deep = path.join(root, 'resources', 'sf_loop');
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, 'client.lua'), 'print("hi")', 'utf8');
    await symlink(path.join(root, 'resources'), path.join(deep, 'loop'), 'dir');

    const result = await walkDirectory(root, { followSymlinks: true, maxDepth: 12 });
    expect(result.files.some((file) => file.relativePath.endsWith('client.lua'))).toBe(true);
    // Deduplication by real path is what stops the cycle; the walk completes.
    expect(result.directoriesVisited).toBeLessThan(20);
  });

  it('stops at the depth limit on a deeply nested tree', async () => {
    let current = root;
    for (let depth = 0; depth < 40; depth += 1) {
      current = path.join(current, `level${String(depth)}`);
    }
    await mkdir(current, { recursive: true });
    await writeFile(path.join(current, 'deep.lua'), 'print("deep")', 'utf8');

    const result = await walkDirectory(root, { maxDepth: 5 });
    expect(result.files).toHaveLength(0);
    expect(result.skipped.some((entry) => entry.reason.includes('depth'))).toBe(true);
  });

  it('stops at the entry limit on a wide tree and says the walk was truncated', async () => {
    const wide = path.join(root, 'resources', 'sf_wide');
    await mkdir(wide, { recursive: true });
    await Promise.all(
      Array.from({ length: 200 }, (_value, index) =>
        writeFile(path.join(wide, `file${String(index)}.lua`), 'print("x")', 'utf8'),
      ),
    );

    const result = await walkDirectory(root, { maxEntries: 50 });
    expect(result.files).toHaveLength(50);
    expect(result.stopReason).toBe('MAX_ENTRIES_REACHED');
  });

  it('does not crash on files with hostile names', async () => {
    const hostile = ['..hidden.lua', '-rf.lua', 'file with spaces.lua', 'file;rm.lua', 'файл.lua', 'emoji-name.lua'];
    for (const name of hostile) {
      await writeFile(path.join(root, name), 'print("x")', 'utf8');
    }
    const result = await walkDirectory(root);
    expect(result.files).toHaveLength(hostile.length);
    for (const file of result.files) {
      expect(file.relativePath.startsWith('..' + path.sep)).toBe(false);
    }
  });

  it('reads a malformed manifest as text without attempting to interpret it', async () => {
    // Analysis of scanned content is textual only; nothing here is executed.
    await writeFile(path.join(root, 'fxmanifest.lua'), "fx_version 'cerulean\nclient_script 'a.lua", 'utf8');
    const result = await readTextFileBounded('fxmanifest.lua', { root });
    expect(result.content).toContain('fx_version');
  });

  it('reads binary content without throwing', async () => {
    await writeFile(path.join(root, 'payload.bin'), Buffer.from([0x00, 0xff, 0x10, 0x00, 0x42]));
    const result = await readTextFileBounded('payload.bin', { root });
    expect(result.bytesRead).toBe(5);
  });
});
