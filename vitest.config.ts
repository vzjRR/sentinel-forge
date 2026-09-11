/**
 * Vitest configuration.
 *
 * Four projects, matching the test categories the product specification
 * requires. Keeping them separate means CI can report which category failed,
 * and a developer can run just the security suite while working on redaction.
 *
 * Workspace packages resolve to their TypeScript sources rather than to build
 * output, so a test run never silently exercises a stale `dist`.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

const workspaceAliases = {
  '@sentinel-forge/shared': path.resolve(rootDirectory, 'packages/shared/src/index.ts'),
  '@sentinel-forge/lua': path.resolve(rootDirectory, 'packages/lua/src/index.ts'),
  '@sentinel-forge/core': path.resolve(rootDirectory, 'packages/core/src/index.ts'),
  '@sentinel-forge/scanner': path.resolve(rootDirectory, 'packages/scanner/src/index.ts'),
  '@sentinel-forge/dependencies': path.resolve(rootDirectory, 'packages/dependencies/src/index.ts'),
  '@sentinel-forge/analyzer': path.resolve(rootDirectory, 'packages/analyzer/src/index.ts'),
  '@sentinel-forge/performance': path.resolve(rootDirectory, 'packages/performance/src/index.ts'),
  '@sentinel-forge/incidents': path.resolve(rootDirectory, 'packages/incidents/src/index.ts'),
  '@sentinel-forge/security': path.resolve(rootDirectory, 'packages/security/src/index.ts'),
  '@sentinel-forge/integrity': path.resolve(rootDirectory, 'packages/integrity/src/index.ts'),
  '@sentinel-forge/runtime': path.resolve(rootDirectory, 'packages/runtime/src/index.ts'),
  '@sentinel-forge/engine': path.resolve(rootDirectory, 'packages/engine/src/index.ts'),
  '@sentinel-forge/reports': path.resolve(rootDirectory, 'packages/reports/src/index.ts'),
  '@sentinel-forge/dashboard': path.resolve(rootDirectory, 'apps/dashboard/src/index.ts'),
  '@sentinel-forge/mcp': path.resolve(rootDirectory, 'apps/mcp/src/index.ts'),
  '@sentinel-forge/cli': path.resolve(rootDirectory, 'apps/cli/src/index.ts'),
};

const shared = {
  environment: 'node' as const,
  globals: false,
  restoreMocks: true,
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    projects: [
      {
        resolve: { alias: workspaceAliases },
        test: {
          ...shared,
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          ...shared,
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          ...shared,
          name: 'security',
          include: ['tests/security/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: workspaceAliases },
        test: {
          ...shared,
          name: 'performance',
          include: ['tests/performance/**/*.test.ts'],
          // Benchmarks measure traversal and hashing cost; they need headroom
          // on slower CI machines without becoming flaky.
          testTimeout: 120_000,
        },
      },
    ],
  },
});
