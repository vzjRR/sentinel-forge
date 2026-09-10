/**
 * Database lifecycle helpers.
 *
 * `openDatabase` is the single entry point used by commands: it creates the
 * containing directory, opens the driver, applies migrations and returns a
 * handle. Callers never construct a driver directly, so the migration step
 * cannot be skipped by accident.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '../logging/logger.js';
import { NodeSqliteDriver } from './node-sqlite.js';
import type { DatabaseDriver } from './driver.js';
import { migrate, type MigrationResult } from './migrate.js';

export const IN_MEMORY_DATABASE = ':memory:';

export interface OpenDatabaseOptions {
  /** File path, or `:memory:`. */
  readonly location: string;
  readonly logger?: Logger;
  /** Skip migrations. Only used by tooling that inspects an existing file. */
  readonly migrate?: boolean;
}

export interface OpenedDatabase {
  readonly driver: DatabaseDriver;
  readonly migration: MigrationResult | null;
  close(): void;
}

export function openDatabase(options: OpenDatabaseOptions): OpenedDatabase {
  const { location, logger, migrate: shouldMigrate = true } = options;

  if (location !== IN_MEMORY_DATABASE) {
    mkdirSync(path.dirname(path.resolve(location)), { recursive: true });
  }

  const driver = new NodeSqliteDriver({ location });
  let migration: MigrationResult | null = null;

  try {
    if (shouldMigrate) {
      migration = migrate(driver);
      if (migration.applied.length > 0) {
        logger?.debug('Applied database migrations.', {
          applied: migration.applied.map((entry) => entry.fileName),
          schemaVersion: migration.schemaVersion,
        });
      }
    }
  } catch (error) {
    driver.close();
    throw error;
  }

  return {
    driver,
    migration,
    close(): void {
      driver.close();
    },
  };
}

/** Opens an in-memory database with migrations applied. Intended for tests. */
export function openInMemoryDatabase(): OpenedDatabase {
  return openDatabase({ location: IN_MEMORY_DATABASE });
}
