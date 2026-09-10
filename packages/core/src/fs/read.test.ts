import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentinelSecurityError, SentinelUserError } from '../errors.js';
import { looksBinary, readTextFileBounded } from './read.js';

describe('bounded file reading', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sentinel-read-'));
    await writeFile(path.join(root, 'small.lua'), 'print("hello")\n', 'utf8');
    await writeFile(path.join(root, 'large.lua'), 'x'.repeat(5000), 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a file inside the root', async () => {
    const result = await readTextFileBounded('small.lua', { root });
    expect(result.content).toBe('print("hello")\n');
    expect(result.truncated).toBe(false);
    expect(result.relativePath).toBe('small.lua');
  });

  it('refuses a path outside the root', async () => {
    await expect(readTextFileBounded('../escape.lua', { root })).rejects.toBeInstanceOf(SentinelSecurityError);
  });

  it('refuses a file above the size limit rather than exhausting memory', async () => {
    await expect(readTextFileBounded('large.lua', { root, maxBytes: 1000 })).rejects.toBeInstanceOf(SentinelUserError);
  });

  it('truncates instead of failing when the caller opts in, and reports that it did', async () => {
    const result = await readTextFileBounded('large.lua', { root, maxBytes: 1000, truncate: true });
    expect(result.bytesRead).toBe(1000);
    expect(result.totalBytes).toBe(5000);
    expect(result.truncated).toBe(true);
  });

  it('refuses to read something that is not a regular file', async () => {
    await mkdir(path.join(root, 'a-directory'));
    await expect(readTextFileBounded('a-directory', { root })).rejects.toBeInstanceOf(SentinelSecurityError);
  });

  it('detects binary content from a sample', () => {
    expect(looksBinary(Buffer.from('print("hello")'))).toBe(false);
    expect(looksBinary(Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).toBe(true);
  });
});
