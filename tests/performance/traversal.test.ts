/**
 * Performance: traversal and hashing at realistic server sizes.
 *
 * The product specification requires benchmarks at 10, 100 and 500 resources.
 * The thresholds here are generous ceilings, not targets: their purpose is to
 * catch an accidental change in complexity (a nested re-walk, a full-file read
 * where a stat would do), not to measure a particular machine. Timings are
 * printed so a regression is visible even when the assertion still passes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashFile, walkDirectory } from '@sentinel-forge/core';
import { createWorkspace, removeWorkspace } from '../helpers/workspace.js';

const FILES_PER_RESOURCE = 4;

async function generateServer(root: string, resourceCount: number): Promise<void> {
  await mkdir(path.join(root, 'resources'), { recursive: true });
  await writeFile(path.join(root, 'server.cfg'), 'sv_maxclients 64\n', 'utf8');

  const work = Array.from({ length: resourceCount }, async (_value, index) => {
    const name = `sf_generated_${String(index).padStart(4, '0')}`;
    const directory = path.join(root, 'resources', name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'fxmanifest.lua'),
      `fx_version 'cerulean'\ngame 'gta5'\nversion '1.0.0'\nclient_script 'client.lua'\nserver_script 'server.lua'\n`,
      'utf8',
    );
    await writeFile(path.join(directory, 'client.lua'), `-- generated client for ${name}\n${'-- filler\n'.repeat(50)}`, 'utf8');
    await writeFile(path.join(directory, 'server.lua'), `-- generated server for ${name}\n${'-- filler\n'.repeat(50)}`, 'utf8');
    await writeFile(path.join(directory, 'config.json'), JSON.stringify({ name, enabled: true }), 'utf8');
  });

  await Promise.all(work);
}

interface Measurement {
  readonly resources: number;
  readonly files: number;
  readonly walkMs: number;
}

describe('traversal performance', () => {
  let base: string;
  const measurements: Measurement[] = [];

  beforeAll(async () => {
    base = await createWorkspace('sentinel-perf-');
  });

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(
      `traversal: ${measurements.map((entry) => `${String(entry.resources)} resources ${entry.walkMs}ms`).join(', ')}`,
    );
    await removeWorkspace(base);
  });

  for (const resourceCount of [10, 100, 500]) {
    it(`walks a ${String(resourceCount)}-resource server`, async () => {
      const root = path.join(base, `server-${String(resourceCount)}`);
      await generateServer(root, resourceCount);

      const started = performance.now();
      const result = await walkDirectory(root);
      const walkMs = Math.round(performance.now() - started);
      measurements.push({ resources: resourceCount, files: result.files.length, walkMs });

      expect(result.files).toHaveLength(resourceCount * FILES_PER_RESOURCE + 1);
      expect(result.stopReason).toBe('COMPLETED');
      // 30s is far above any reasonable result; it fails only on a complexity change.
      expect(walkMs).toBeLessThan(30_000);
    });
  }

  it('scales close to linearly between 100 and 500 resources', () => {
    const hundred = measurements.find((entry) => entry.resources === 100);
    const fiveHundred = measurements.find((entry) => entry.resources === 500);
    expect(hundred).toBeDefined();
    expect(fiveHundred).toBeDefined();

    // Quadratic growth would be ~25x. A generous 15x ceiling catches that while
    // tolerating the noise of a shared CI machine, and floors the baseline at
    // 5ms so a sub-millisecond measurement cannot make the ratio meaningless.
    const baseline = Math.max(hundred?.walkMs ?? 1, 5);
    expect((fiveHundred?.walkMs ?? 0) / baseline).toBeLessThan(15);
  });

  it('hashes a large file by streaming rather than buffering it', async () => {
    const root = path.join(base, 'large-file');
    await mkdir(root, { recursive: true });
    const file = path.join(root, 'big.lua');
    await writeFile(file, '-- filler line\n'.repeat(400_000), 'utf8');

    const before = process.memoryUsage().heapUsed;
    const started = performance.now();
    const hash = await hashFile(file);
    const elapsed = Math.round(performance.now() - started);
    const heapGrowth = process.memoryUsage().heapUsed - before;

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(elapsed).toBeLessThan(20_000);
    // The file is ~6 MB; a buffering implementation would show growth of that order.
    expect(heapGrowth).toBeLessThan(6 * 1024 * 1024);
  });
});
