import { describe, expect, it } from 'vitest';
import { SentinelInternalError } from '../errors.js';
import { NodeSqliteDriver } from './node-sqlite.js';
import { latestSchemaVersion, listAppliedMigrations, listMigrations, migrate } from './migrate.js';
import { openInMemoryDatabase } from './open.js';

const REQUIRED_TABLES = [
  'servers',
  'resources',
  'resource_files',
  'dependencies',
  'baselines',
  'performance_samples',
  'findings',
  'incidents',
  'incident_events',
  'integrity_snapshots',
  'security_findings',
  'scan_runs',
];

function tableNames(driver: NodeSqliteDriver): string[] {
  return driver
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all<{ name: string }>()
    .map((row) => row.name);
}

describe('database migrations', () => {
  it('creates every table the product specification requires', () => {
    const database = openInMemoryDatabase();
    try {
      const tables = tableNames(database.driver as NodeSqliteDriver);
      for (const table of REQUIRED_TABLES) {
        expect(tables, `${table} must exist`).toContain(table);
      }
    } finally {
      database.close();
    }
  });

  it('records the applied migration with its checksum', () => {
    const database = openInMemoryDatabase();
    try {
      const applied = listAppliedMigrations(database.driver);
      expect(applied).toHaveLength(listMigrations().length);
      expect(applied[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(database.migration?.schemaVersion).toBe(latestSchemaVersion());
    } finally {
      database.close();
    }
  });

  it('is idempotent: a second run applies nothing', () => {
    const driver = new NodeSqliteDriver({ location: ':memory:' });
    try {
      const first = migrate(driver);
      const second = migrate(driver);
      expect(first.applied.length).toBeGreaterThan(0);
      expect(second.applied).toHaveLength(0);
      expect(second.alreadyApplied).toBe(first.applied.length);
    } finally {
      driver.close();
    }
  });

  it('refuses to run when an already-applied migration has been edited', () => {
    const driver = new NodeSqliteDriver({ location: ':memory:' });
    try {
      migrate(driver);
      driver.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('0'.repeat(64));
      expect(() => migrate(driver)).toThrow(SentinelInternalError);
      expect(() => migrate(driver)).toThrow(/has changed since it was applied/);
    } finally {
      driver.close();
    }
  });

  it('refuses a database written by a newer build', () => {
    const driver = new NodeSqliteDriver({ location: ':memory:' });
    try {
      migrate(driver);
      driver
        .prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(999, 'from_the_future', '0'.repeat(64), new Date().toISOString());
      expect(() => migrate(driver)).toThrow(/newer version of Sentinel Forge/);
    } finally {
      driver.close();
    }
  });

  it('enforces foreign keys, so purging a server removes everything recorded about it', () => {
    const database = openInMemoryDatabase();
    try {
      const { driver } = database;
      const now = new Date().toISOString();
      driver
        .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
        .run('srv_1', '/opt/fxserver', 'abc', now, now);
      driver
        .prepare(
          'INSERT INTO scan_runs (id, server_id, command, product_version, started_at, status) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('run_1', 'srv_1', 'scan', '0.1.0', now, 'COMPLETED');

      driver.prepare('DELETE FROM servers WHERE id = ?').run('srv_1');
      const remaining = driver.prepare('SELECT COUNT(*) AS count FROM scan_runs').get<{ count: number }>();
      expect(remaining?.count).toBe(0);
    } finally {
      database.close();
    }
  });

  it('rejects a row that violates a foreign key', () => {
    const database = openInMemoryDatabase();
    try {
      expect(() => {
        database.driver
          .prepare(
            'INSERT INTO scan_runs (id, server_id, command, product_version, started_at, status) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run('run_x', 'srv_missing', 'scan', '0.1.0', new Date().toISOString(), 'COMPLETED');
      }).toThrow();
    } finally {
      database.close();
    }
  });
});

describe('database driver', () => {
  it('rolls back a failed transaction', () => {
    const database = openInMemoryDatabase();
    try {
      const { driver } = database;
      const now = new Date().toISOString();
      expect(() =>
        driver.transaction(() => {
          driver
            .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
            .run('srv_rollback', '/opt/a', 'abc', now, now);
          throw new Error('failure inside the transaction');
        }),
      ).toThrow('failure inside the transaction');

      const count = driver.prepare('SELECT COUNT(*) AS count FROM servers').get<{ count: number }>();
      expect(count?.count).toBe(0);
    } finally {
      database.close();
    }
  });

  it('supports nested transactions through savepoints', () => {
    const database = openInMemoryDatabase();
    try {
      const { driver } = database;
      const now = new Date().toISOString();
      driver.transaction(() => {
        driver
          .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
          .run('srv_outer', '/opt/a', 'abc', now, now);
        expect(() =>
          driver.transaction(() => {
            driver
              .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
              .run('srv_inner', '/opt/b', 'def', now, now);
            throw new Error('inner failure');
          }),
        ).toThrow('inner failure');
      });

      const ids = driver.prepare('SELECT id FROM servers ORDER BY id').all<{ id: string }>().map((row) => row.id);
      expect(ids).toEqual(['srv_outer']);
    } finally {
      database.close();
    }
  });

  it('binds booleans as integers', () => {
    const database = openInMemoryDatabase();
    try {
      const { driver } = database;
      const now = new Date().toISOString();
      driver
        .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
        .run('srv_1', '/opt/fxserver', 'abc', now, now);
      driver
        .prepare(
          'INSERT INTO dependencies (server_id, from_resource, to_resource, kind, resolved, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('srv_1', 'sf_shop', 'sf_inventory', 'DECLARED', false, now);

      const row = driver.prepare('SELECT resolved FROM dependencies').get<{ resolved: number }>();
      expect(row?.resolved).toBe(0);
    } finally {
      database.close();
    }
  });

  it('refuses to be used after it is closed', () => {
    const database = openInMemoryDatabase();
    database.close();
    expect(() => database.driver.exec('SELECT 1')).toThrow(SentinelInternalError);
    expect(database.driver.open).toBe(false);
  });
});
