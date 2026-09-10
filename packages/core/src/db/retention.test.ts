import { describe, expect, it } from 'vitest';
import { openInMemoryDatabase, type OpenedDatabase } from './open.js';
import { describeStorage, purge, type RetentionPolicy } from './retention.js';

const POLICY: RetentionPolicy = {
  performanceSampleDays: 30,
  scanRunDays: 90,
  incidentDays: 180,
  integritySnapshotDays: 90,
};

const NOW = new Date('2026-06-01T00:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seed(database: OpenedDatabase): void {
  const { driver } = database;
  driver
    .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .run('srv_1', '/opt/fxserver', 'fp', daysAgo(365), daysAgo(0));

  const scanRun = driver.prepare(
    'INSERT INTO scan_runs (id, server_id, command, product_version, started_at, status) VALUES (?, ?, ?, ?, ?, ?)',
  );
  scanRun.run('run_old', 'srv_1', 'scan', '0.3.0', daysAgo(120), 'COMPLETED');
  scanRun.run('run_new', 'srv_1', 'scan', '0.3.0', daysAgo(5), 'COMPLETED');

  const sample = driver.prepare(
    'INSERT INTO performance_samples (server_id, resource_name, metric, value, unit, sampled_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  sample.run('srv_1', 'sf_core', 'tick', 0.2, 'ms', daysAgo(45), 'test');
  sample.run('srv_1', 'sf_core', 'tick', 0.2, 'ms', daysAgo(2), 'test');

  driver
    .prepare(
      'INSERT INTO incidents (id, server_id, started_at, severity, confidence, summary, affected_resources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run('inc_old', 'srv_1', daysAgo(200), 'LOW', 0.5, 'Old incident', '[]', daysAgo(200));
}

function withSeeded<T>(work: (database: OpenedDatabase) => T): T {
  const database = openInMemoryDatabase();
  try {
    seed(database);
    return work(database);
  } finally {
    database.close();
  }
}

describe('retention and purge', () => {
  it('reports what it would delete without deleting anything', () => {
    withSeeded((database) => {
      const result = purge(database.driver, { scope: 'RETENTION', policy: POLICY, dryRun: true, now: NOW });
      expect(result.dryRun).toBe(true);
      expect(result.total).toBeGreaterThan(0);

      const runs = database.driver.prepare('SELECT COUNT(*) AS count FROM scan_runs').get<{ count: number }>();
      expect(runs?.count).toBe(2);
    });
  });

  it('expires only records older than the policy', () => {
    withSeeded((database) => {
      purge(database.driver, { scope: 'RETENTION', policy: POLICY, now: NOW });

      const runs = database.driver.prepare('SELECT id FROM scan_runs').all<{ id: string }>();
      expect(runs.map((row) => row.id)).toEqual(['run_new']);

      const samples = database.driver.prepare('SELECT COUNT(*) AS count FROM performance_samples').get<{ count: number }>();
      expect(samples?.count).toBe(1);
    });
  });

  it('keeps a record type whose retention window is zero', () => {
    withSeeded((database) => {
      purge(database.driver, {
        scope: 'RETENTION',
        policy: { ...POLICY, scanRunDays: 0 },
        now: NOW,
      });
      const runs = database.driver.prepare('SELECT COUNT(*) AS count FROM scan_runs').get<{ count: number }>();
      expect(runs?.count).toBe(2);
    });
  });

  it('deletes everything for one server when the scope is ALL', () => {
    withSeeded((database) => {
      purge(database.driver, { scope: 'ALL', serverId: 'srv_1', now: NOW });
      for (const table of ['servers', 'scan_runs', 'performance_samples', 'incidents']) {
        const count = database.driver.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get<{ count: number }>();
        expect(count?.count, table).toBe(0);
      }
    });
  });

  it('reports the dry-run counts that a real run then matches', () => {
    withSeeded((database) => {
      const preview = purge(database.driver, { scope: 'RETENTION', policy: POLICY, dryRun: true, now: NOW });
      const actual = purge(database.driver, { scope: 'RETENTION', policy: POLICY, now: NOW });
      expect(actual.total).toBe(preview.total);
      expect(actual.deleted).toEqual(preview.deleted);
    });
  });

  it('describes what is stored, per table', () => {
    withSeeded((database) => {
      const usage = describeStorage(database.driver, 'srv_1');
      const byTable = new Map(usage.map((entry) => [entry.table, entry.rows]));
      expect(byTable.get('scan_runs')).toBe(2);
      expect(byTable.get('performance_samples')).toBe(2);
      expect(byTable.get('servers')).toBe(1);
    });
  });

  it('is safe to run against an empty database', () => {
    const database = openInMemoryDatabase();
    try {
      const result = purge(database.driver, { scope: 'RETENTION', policy: POLICY, now: NOW });
      expect(result.total).toBe(0);
    } finally {
      database.close();
    }
  });
});
