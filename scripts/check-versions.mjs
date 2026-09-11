#!/usr/bin/env node
/**
 * Verifies that the product version is stated consistently.
 *
 * Three places can disagree: the root package.json, each workspace package's
 * version and its `@sentinel-forge/*` dependency ranges, and the PRODUCT_VERSION
 * constant that ends up in every report. A mismatch there is invisible until a
 * consumer receives a report whose version does not match the release it came
 * from, so it is checked in CI instead.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
}

const rootVersion = readJson('package.json').version;
const problems = [];

/** Every directory under `packages/` and `apps/` that is a real workspace. */
function workspacesIn(directory) {
  return readdirSync(path.join(repositoryRoot, directory))
    .map((name) => `${directory}/${name}/package.json`)
    .filter((relative) => {
      try {
        readJson(relative);
        return true;
      } catch {
        // A placeholder directory with no manifest is not a workspace. It is
        // skipped rather than failing the check, which is how a gate's
        // not-yet-built package is allowed to exist as a directory.
        return false;
      }
    });
}

const workspaceManifests = [...workspacesIn('packages'), ...workspacesIn('apps')];

for (const relative of workspaceManifests) {
  const manifest = readJson(relative);
  if (manifest.version !== rootVersion) {
    problems.push(`${relative}: version ${manifest.version} does not match root version ${rootVersion}`);
  }
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith('@sentinel-forge/') && range !== rootVersion) {
      problems.push(`${relative}: dependency ${name}@${range} does not match root version ${rootVersion}`);
    }
  }
}

const productSource = readFileSync(path.join(repositoryRoot, 'packages/shared/src/product.ts'), 'utf8');
const declared = /PRODUCT_VERSION = '([^']+)'/.exec(productSource)?.[1];
if (declared !== rootVersion) {
  problems.push(`packages/shared/src/product.ts: PRODUCT_VERSION ${declared} does not match root version ${rootVersion}`);
}

if (problems.length > 0) {
  console.error('Version mismatch:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`Versions consistent at ${rootVersion} across ${workspaceManifests.length} workspace package(s).`);
