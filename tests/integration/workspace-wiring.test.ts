/**
 * Integration: workspace wiring.
 *
 * Adding a package means touching five files. Forgetting one of them fails in a
 * way that is easy to miss locally and obvious only on a clean machine — and in
 * the case of the test alias map, it fails *silently*, with tests exercising
 * stale build output instead of source.
 *
 * This test makes each of those omissions fail immediately and by name.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repositoryRoot } from '../helpers/workspace.js';

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8')) as T;
}

/** Directories under `packages/` that are real workspace packages. */
async function listPackageDirectories(): Promise<string[]> {
  const entries = await readdir(path.join(repositoryRoot, 'packages'), { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(path.join(repositoryRoot, 'packages', entry.name, 'package.json'), 'utf8');
      names.push(entry.name);
    } catch {
      // A placeholder directory with only a README is not yet a package.
    }
  }
  return names.sort();
}

describe('workspace wiring', () => {
  it('registers every package in the root workspaces list', async () => {
    const root = await readJson<{ workspaces: string[] }>('package.json');
    for (const name of await listPackageDirectories()) {
      expect(root.workspaces, `packages/${name} must be a workspace`).toContain(`packages/${name}`);
    }
  });

  it('references every package from the root tsconfig, so `tsc --build` covers it', async () => {
    const root = await readJson<{ references: { path: string }[] }>('tsconfig.json');
    const referenced = root.references.map((reference) => reference.path);
    for (const name of await listPackageDirectories()) {
      expect(referenced, `packages/${name} must be referenced`).toContain(`packages/${name}`);
    }
  });

  it('maps every package in tsconfig.test.json, so type-aware linting resolves it', async () => {
    const testConfig = await readJson<{ compilerOptions: { paths: Record<string, string[]> } }>('tsconfig.test.json');
    for (const name of await listPackageDirectories()) {
      const manifest = await readJson<{ name: string }>(`packages/${name}/package.json`);
      expect(Object.keys(testConfig.compilerOptions.paths), `${manifest.name} must be mapped`).toContain(manifest.name);
    }
  });

  it('aliases every package in the Vitest config, so tests run against source', async () => {
    // Without an alias, an import resolves through node_modules to dist, and the
    // suite silently exercises whatever was built last.
    const config = await readFile(path.join(repositoryRoot, 'vitest.config.ts'), 'utf8');
    for (const name of await listPackageDirectories()) {
      const manifest = await readJson<{ name: string }>(`packages/${name}/package.json`);
      expect(config, `${manifest.name} must be aliased`).toContain(`'${manifest.name}': path.resolve`);
    }
  });

  it('gives every package the same version as the root', async () => {
    const root = await readJson<{ version: string }>('package.json');
    for (const name of await listPackageDirectories()) {
      const manifest = await readJson<{ version: string }>(`packages/${name}/package.json`);
      expect(manifest.version, `packages/${name}`).toBe(root.version);
    }
  });

  it('declares every workspace dependency it imports', async () => {
    for (const name of await listPackageDirectories()) {
      const manifest = await readJson<{ name: string; dependencies?: Record<string, string> }>(
        `packages/${name}/package.json`,
      );
      const declared = new Set(Object.keys(manifest.dependencies ?? {}));

      const sourceDirectory = path.join(repositoryRoot, 'packages', name, 'src');
      const files = await readdir(sourceDirectory, { recursive: true, withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.ts') || file.name.endsWith('.test.ts')) continue;
        const source = await readFile(path.join(file.parentPath, file.name), 'utf8');
        for (const match of source.matchAll(/from '(@sentinel-forge\/[a-z-]+)'/g)) {
          const imported = match[1] ?? '';
          if (imported === manifest.name) continue;
          expect(declared, `packages/${name} imports ${imported} without declaring it`).toContain(imported);
        }
      }
    }
  });
});
