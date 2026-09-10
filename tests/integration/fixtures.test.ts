/**
 * Integration: fixture inventory.
 *
 * The fixtures are the shared ground truth for every later gate. These tests
 * hold two properties: the fixtures stay synthetic, and their declared
 * expectations reference rules that actually exist in the published catalog.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashFile, walkDirectory } from '@sentinel-forge/core';
import { isKnownRuleId } from '@sentinel-forge/shared';
import { fixturesRoot } from '../helpers/workspace.js';

interface FixtureManifest {
  readonly name: string;
  readonly synthetic: boolean;
  readonly description: string;
  readonly expectedRules: readonly string[];
  readonly notes?: string;
}

const EXPECTED_FIXTURES = [
  'healthy-server',
  'missing-dependency',
  'broken-manifest',
  'performance-smell',
  'security-indicators',
  'integrity-change',
  'mixed-server',
];

async function listFixtureDirectories(): Promise<string[]> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readManifest(name: string): Promise<FixtureManifest> {
  return JSON.parse(await readFile(path.join(fixturesRoot, name, 'fixture.json'), 'utf8')) as FixtureManifest;
}

describe('test fixtures', () => {
  it('provides every fixture the product specification names', async () => {
    const directories = await listFixtureDirectories();
    for (const name of EXPECTED_FIXTURES) {
      expect(directories, `${name} fixture must exist`).toContain(name);
    }
  });

  it('declares each fixture as synthetic', async () => {
    for (const name of await listFixtureDirectories()) {
      const manifest = await readManifest(name);
      expect(manifest.synthetic, `${name} must be marked synthetic`).toBe(true);
      expect(manifest.name).toBe(name);
      expect(manifest.description.length).toBeGreaterThan(20);
    }
  });

  it('references only rule ids that exist in the catalog', async () => {
    for (const name of await listFixtureDirectories()) {
      const manifest = await readManifest(name);
      for (const ruleId of manifest.expectedRules) {
        expect(isKnownRuleId(ruleId), `${name} expects unknown rule ${ruleId}`).toBe(true);
      }
    }
  });

  it('gives every fixture a server configuration and at least one resource', async () => {
    for (const name of await listFixtureDirectories()) {
      const fixture = path.join(fixturesRoot, name);
      // integrity-change holds two complete server trees rather than one.
      const roots = name === 'integrity-change' ? [path.join(fixture, 'before'), path.join(fixture, 'after')] : [fixture];
      for (const root of roots) {
        expect((await stat(path.join(root, 'server.cfg'))).isFile(), `${root} server.cfg`).toBe(true);
        const resources = await readdir(path.join(root, 'resources'));
        expect(resources.length, `${root} resources`).toBeGreaterThan(0);
      }
    }
  });

  it('is traversable with the bounded walker and produces stable relative paths', async () => {
    const result = await walkDirectory(path.join(fixturesRoot, 'mixed-server'));
    expect(result.stopReason).toBe('COMPLETED');
    expect(result.skipped).toEqual([]);
    const paths = result.files.map((file) => file.relativePath);
    expect(paths).toContain('server.cfg');
    expect(paths).toContain('resources/sf_shop/fxmanifest.lua');
    expect(paths.every((entry) => !entry.includes('\\'))).toBe(true);
  });

  it('produces a stable content hash for the integrity fixture and detects the changed file', async () => {
    const before = path.join(fixturesRoot, 'integrity-change', 'before', 'resources', 'sf_core', 'server', 'main.lua');
    const after = path.join(fixturesRoot, 'integrity-change', 'after', 'resources', 'sf_core', 'server', 'main.lua');
    const beforeHash = await hashFile(before);
    expect(await hashFile(before)).toBe(beforeHash);
    expect(await hashFile(after)).not.toBe(beforeHash);
  });

  it('describes the added and deleted files declared by the integrity fixture', async () => {
    const beforeWalk = await walkDirectory(path.join(fixturesRoot, 'integrity-change', 'before'));
    const afterWalk = await walkDirectory(path.join(fixturesRoot, 'integrity-change', 'after'));
    const beforePaths = new Set(beforeWalk.files.map((file) => file.relativePath));
    const afterPaths = new Set(afterWalk.files.map((file) => file.relativePath));

    const added = [...afterPaths].filter((entry) => !beforePaths.has(entry));
    const deleted = [...beforePaths].filter((entry) => !afterPaths.has(entry));
    expect(added).toEqual(['resources/sf_core/server/extra.lua']);
    expect(deleted).toEqual(['resources/sf_core/client/legacy.lua']);
  });
});
