#!/usr/bin/env node
/**
 * Embeds `database/migrations/*.sql` into a generated TypeScript module.
 *
 * The .sql files are the source of truth: they are reviewable, diffable, and
 * usable with any SQLite tool. Embedding them at build time means a packaged
 * release does not have to locate a sibling directory at runtime, which is the
 * usual cause of "migrations not found" failures after packaging.
 *
 * Run via `npm run generate:migrations`. CI runs `npm run check:migrations`,
 * which fails when the committed output is stale.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDirectory = path.join(repositoryRoot, 'database', 'migrations');
const outputFile = path.join(repositoryRoot, 'packages', 'core', 'src', 'db', 'migrations.generated.ts');

const FILE_NAME_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

function collectMigrations() {
  const entries = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();
  const migrations = [];
  const seenVersions = new Set();

  for (const name of entries) {
    const match = FILE_NAME_PATTERN.exec(name);
    if (match === null) {
      throw new Error(`Migration file name must match NNNN_snake_case.sql: ${name}`);
    }
    const version = Number.parseInt(match[1], 10);
    if (seenVersions.has(version)) {
      throw new Error(`Duplicate migration version ${version} (${name}).`);
    }
    seenVersions.add(version);

    const sql = readFileSync(path.join(migrationsDirectory, name), 'utf8');
    migrations.push({
      version,
      name: match[2],
      fileName: name,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
  }

  migrations.sort((a, b) => a.version - b.version);

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migration versions must be contiguous starting at 1. Expected ${index + 1}, found ${migration.version}.`,
      );
    }
  });

  return migrations;
}

function render(migrations) {
  const body = migrations
    .map(
      (migration) => `  {
    version: ${migration.version},
    name: ${JSON.stringify(migration.name)},
    fileName: ${JSON.stringify(migration.fileName)},
    checksum: ${JSON.stringify(migration.checksum)},
    sql: ${JSON.stringify(migration.sql)},
  },`,
    )
    .join('\n');

  return `/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Source: database/migrations/*.sql
 * Regenerate with: npm run generate:migrations
 */

import type { Migration } from './migrate.js';

export const MIGRATIONS: readonly Migration[] = Object.freeze([
${body}
]);
`;
}

const migrations = collectMigrations();
const rendered = render(migrations);

if (process.argv.includes('--check')) {
  let current;
  try {
    current = readFileSync(outputFile, 'utf8');
  } catch {
    current = '';
  }
  if (current !== rendered) {
    console.error(
      'Generated migrations are stale. Run `npm run generate:migrations` and commit packages/core/src/db/migrations.generated.ts.',
    );
    process.exit(1);
  }
  console.log(`Migrations up to date (${migrations.length} migration(s)).`);
} else {
  writeFileSync(outputFile, rendered, 'utf8');
  console.log(`Generated ${path.relative(repositoryRoot, outputFile)} from ${migrations.length} migration(s).`);
}
