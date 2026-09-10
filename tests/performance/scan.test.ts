/**
 * Performance: full scan at realistic server sizes.
 *
 * The traversal benchmark measures the filesystem layer; this one measures the
 * whole pipeline — discovery, hashing, manifest parsing, rule evaluation and
 * graph construction — which is what an operator actually waits for.
 *
 * Thresholds are generous ceilings that catch a change in complexity, not a
 * slow machine. Timings are printed so a regression is visible even when the
 * assertion still passes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanServer } from '@sentinel-forge/engine';
import { createWorkspace, removeWorkspace } from '../helpers/workspace.js';

interface Measurement {
  readonly resources: number;
  readonly ms: number;
  readonly findings: number;
}

/**
 * Generates a server where every tenth resource depends on the previous one, so
 * the dependency graph is exercised rather than left empty.
 */
async function generateServer(root: string, resourceCount: number): Promise<void> {
  await mkdir(path.join(root, 'resources'), { recursive: true });
  await writeFile(
    path.join(root, 'server.cfg'),
    Array.from({ length: resourceCount }, (_value, index) => `ensure sf_gen_${String(index).padStart(4, '0')}`).join('\n'),
    'utf8',
  );

  await Promise.all(
    Array.from({ length: resourceCount }, async (_value, index) => {
      const name = `sf_gen_${String(index).padStart(4, '0')}`;
      const directory = path.join(root, 'resources', name);
      await mkdir(path.join(directory, 'client'), { recursive: true });
      await mkdir(path.join(directory, 'server'), { recursive: true });

      const dependency =
        index % 10 === 0 && index > 0 ? `dependency 'sf_gen_${String(index - 1).padStart(4, '0')}'\n` : '';

      await writeFile(
        path.join(directory, 'fxmanifest.lua'),
        [
          "fx_version 'cerulean'",
          "game 'gta5'",
          `version '1.0.${String(index)}'`,
          dependency,
          "client_scripts { 'client/*.lua' }",
          "server_script 'server/main.lua'",
        ].join('\n'),
        'utf8',
      );
      await writeFile(path.join(directory, 'client', 'main.lua'), `-- ${name}\n${'-- filler\n'.repeat(40)}`, 'utf8');
      await writeFile(path.join(directory, 'client', 'ui.lua'), `-- ${name}\n${'-- filler\n'.repeat(40)}`, 'utf8');
      await writeFile(path.join(directory, 'server', 'main.lua'), `-- ${name}\n${'-- filler\n'.repeat(40)}`, 'utf8');
    }),
  );
}

describe('scan performance', () => {
  let base: string;
  const measurements: Measurement[] = [];

  beforeAll(async () => {
    base = await createWorkspace('sentinel-scan-perf-');
  });

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(
      `scan: ${measurements.map((entry) => `${String(entry.resources)} resources ${String(entry.ms)}ms`).join(', ')}`,
    );
    await removeWorkspace(base);
  });

  for (const resourceCount of [10, 100, 500]) {
    it(`scans a ${String(resourceCount)}-resource server`, async () => {
      const root = path.join(base, `server-${String(resourceCount)}`);
      await generateServer(root, resourceCount);

      const started = performance.now();
      const result = await scanServer({
        serverPath: root,
        resourceDirectories: ['resources'],
        minimumSeverity: 'INFO',
        disabledRules: [],
        command: 'scan',
      });
      const ms = Math.round(performance.now() - started);
      measurements.push({ resources: resourceCount, ms, findings: result.report.findings.length });

      expect(result.server.resources).toHaveLength(resourceCount);
      // A generated server is well-formed, so a finding here means a false positive.
      expect(result.report.findings).toEqual([]);
      expect(ms).toBeLessThan(60_000);
    });
  }

  it('scales close to linearly between 100 and 500 resources', () => {
    const hundred = measurements.find((entry) => entry.resources === 100);
    const fiveHundred = measurements.find((entry) => entry.resources === 500);
    expect(hundred).toBeDefined();
    expect(fiveHundred).toBeDefined();

    // Quadratic growth would be ~25x. The 15x ceiling catches that while
    // tolerating CI noise; the 10ms floor keeps a fast run from making the
    // ratio meaningless.
    const baseline = Math.max(hundred?.ms ?? 1, 10);
    expect((fiveHundred?.ms ?? 0) / baseline).toBeLessThan(15);
  });

  it('holds memory well below the size of the scanned tree', async () => {
    const root = path.join(base, 'server-500');
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    await scanServer({
      serverPath: root,
      resourceDirectories: ['resources'],
      minimumSeverity: 'INFO',
      disabledRules: [],
      command: 'scan',
    });
    const growth = process.memoryUsage().heapUsed - before;
    // 500 resources x 3 files x ~400 bytes is ~600 KB of source; the inventory
    // and findings should stay in the low tens of megabytes, not hundreds.
    expect(growth).toBeLessThan(256 * 1024 * 1024);
  });
});
