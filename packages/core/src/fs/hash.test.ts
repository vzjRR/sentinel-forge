import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HASH_ALGORITHM, fingerprint, hashFile, hashString, shortHash } from './hash.js';

describe('hashing', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sentinel-hash-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses sha256 and produces lowercase hex', () => {
    expect(HASH_ALGORITHM).toBe('sha256');
    expect(hashString('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hashString('sentinel')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes file content identically to string content', async () => {
    const file = path.join(root, 'client.lua');
    await writeFile(file, 'print("hello")', 'utf8');
    expect(await hashFile(file)).toBe(hashString('print("hello")'));
  });

  it('detects a one-character change', async () => {
    const file = path.join(root, 'client.lua');
    await writeFile(file, 'print("hello")', 'utf8');
    const before = await hashFile(file);
    await writeFile(file, 'print("hellO")', 'utf8');
    expect(await hashFile(file)).not.toBe(before);
  });

  it('produces a fingerprint independent of input order', () => {
    expect(fingerprint(['a', 'b', 'c'])).toBe(fingerprint(['c', 'a', 'b']));
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['a', 'b', 'c']));
  });

  it('distinguishes differently-partitioned inputs', () => {
    // Without a separator, ['ab','c'] and ['a','bc'] would collide.
    expect(fingerprint(['ab', 'c'])).not.toBe(fingerprint(['a', 'bc']));
  });

  it('shortens a hash for display without altering it', () => {
    const hash = hashString('sentinel');
    expect(shortHash(hash)).toBe(hash.slice(0, 12));
  });
});
