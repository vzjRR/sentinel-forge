/**
 * Migration runner.
 *
 * Migrations are forward-only and applied in one transaction each. Every
 * applied migration is recorded with the checksum of the SQL that was executed,
 * so a database opened by a different build can detect that a migration it has
 * already applied has since been edited — which is a development error that
 * silently corrupts schema assumptions if it goes unnoticed.
 */

import { SentinelInternalError } from '../errors.js';
import type { DatabaseDriver } from './driver.js';
import { MIGRATIONS } from './migrations.generated.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly fileName: string;
  /** SHA-256 of the SQL text, recorded when the migration is applied. */
  readonly checksum: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationResult {
  readonly applied: readonly Migration[];
  readonly alreadyApplied: number;
  readonly schemaVersion: number;
}

const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;
`;

export function listMigrations(): readonly Migration[] {
  return MIGRATIONS;
}

export function latestSchemaVersion(): number {
  return MIGRATIONS.reduce((highest, migration) => Math.max(highest, migration.version), 0);
}

export function listAppliedMigrations(driver: DatabaseDriver): readonly AppliedMigration[] {
  driver.exec(MIGRATION_TABLE_SQL);
  return driver
    .prepare('SELECT version, name, checksum, applied_at AS appliedAt FROM schema_migrations ORDER BY version')
    .all<AppliedMigration>();
}

/**
 * Applies every migration not yet recorded in `schema_migrations`.
 *
 * @param now - Timestamp source, injected so tests stay deterministic.
 * @throws {SentinelInternalError} when an already-applied migration's checksum
 *   no longer matches the migration shipped in this build, or when the database
 *   is newer than the build understands.
 */
export function migrate(driver: DatabaseDriver, now: () => Date = () => new Date()): MigrationResult {
  driver.exec(MIGRATION_TABLE_SQL);

  const applied = new Map(listAppliedMigrations(driver).map((entry) => [entry.version, entry]));
  const highestApplied = [...applied.keys()].reduce((highest, version) => Math.max(highest, version), 0);

  if (highestApplied > latestSchemaVersion()) {
    throw new SentinelInternalError(
      `The local database was created by a newer version of Sentinel Forge (schema ${highestApplied}; this build understands ${latestSchemaVersion()}).`,
      { remediation: 'Update Sentinel Forge, or point --database at a different file.' },
    );
  }

  for (const [version, entry] of applied) {
    const migration = MIGRATIONS.find((candidate) => candidate.version === version);
    if (migration === undefined) continue;
    if (migration.checksum !== entry.checksum) {
      throw new SentinelInternalError(
        `Migration ${migration.fileName} has changed since it was applied to this database.`,
        {
          remediation:
            'Applied migrations must never be edited. Add a new migration instead, or recreate the local database.',
          details: { version, expected: entry.checksum, found: migration.checksum },
        },
      );
    }
  }

  const pending = MIGRATIONS.filter((migration) => !applied.has(migration.version));
  const appliedNow: Migration[] = [];

  for (const migration of pending) {
    driver.transaction(() => {
      driver.exec(migration.sql);
      driver
        .prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, migration.checksum, now().toISOString());
    });
    appliedNow.push(migration);
  }

  return {
    applied: appliedNow,
    alreadyApplied: applied.size,
    schemaVersion: latestSchemaVersion(),
  };
}
