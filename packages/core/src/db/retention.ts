/**
 * Data retention.
 *
 * Sentinel Forge accumulates history so it can answer "what changed". History
 * that is never expired becomes an ever-growing file of information the operator
 * did not ask to keep, so retention is configurable and enforceable, and
 * deleting everything is one command.
 *
 * Two guarantees hold here:
 *   - nothing outside the local database is ever deleted; the FiveM server is
 *     never touched;
 *   - a dry run reports exactly what a real run would delete.
 */

import type { DatabaseDriver } from './driver.js';

export interface RetentionPolicy {
  readonly performanceSampleDays: number;
  readonly scanRunDays: number;
  readonly incidentDays: number;
  readonly integritySnapshotDays: number;
}

export type PurgeScope = 'RETENTION' | 'ALL';

export interface PurgeOptions {
  readonly serverId?: string;
  /** `RETENTION` expires by policy; `ALL` deletes every record for the server. */
  readonly scope: PurgeScope;
  readonly policy?: RetentionPolicy;
  /** When true, nothing is deleted and the counts describe what would be. */
  readonly dryRun?: boolean;
  readonly now?: Date;
}

export interface PurgeResult {
  readonly dryRun: boolean;
  readonly scope: PurgeScope;
  /** Rows deleted (or that would be deleted) per table. */
  readonly deleted: Readonly<Record<string, number>>;
  readonly total: number;
}

interface RetentionTarget {
  readonly table: string;
  readonly timestampColumn: string;
  readonly days: number;
}

function cutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Expires records older than the policy, or deletes everything for a server.
 *
 * A policy value of `0` disables expiry for that record type, which is why the
 * targets are filtered rather than treated as "delete everything older than
 * now".
 */
export function purge(driver: DatabaseDriver, options: PurgeOptions): PurgeResult {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const deleted: Record<string, number> = {};

  const run = (sql: string, parameters: readonly (string | number)[], table: string): void => {
    if (dryRun) {
      const countSql = sql.replace(/^DELETE FROM (\w+)/, 'SELECT COUNT(*) AS count FROM $1');
      const row = driver.prepare(countSql).get<{ count: number }>(...parameters);
      deleted[table] = (deleted[table] ?? 0) + (row?.count ?? 0);
      return;
    }
    const result = driver.prepare(sql).run(...parameters);
    deleted[table] = (deleted[table] ?? 0) + result.changes;
  };

  driver.transaction(() => {
    if (options.scope === 'ALL') {
      // Deleting the server row cascades to everything recorded about it, which
      // is exactly what the schema's foreign keys were designed for.
      if (options.serverId === undefined) {
        for (const table of ['incidents', 'baselines', 'performance_samples', 'integrity_snapshots', 'scan_runs', 'resources', 'dependencies', 'servers']) {
          run(`DELETE FROM ${table}`, [], table);
        }
      } else {
        run('DELETE FROM servers WHERE id = ?', [options.serverId], 'servers');
      }
      return;
    }

    const policy = options.policy;
    if (policy === undefined) return;

    const targets: RetentionTarget[] = [
      { table: 'performance_samples', timestampColumn: 'sampled_at', days: policy.performanceSampleDays },
      { table: 'scan_runs', timestampColumn: 'started_at', days: policy.scanRunDays },
      { table: 'incidents', timestampColumn: 'started_at', days: policy.incidentDays },
      { table: 'integrity_snapshots', timestampColumn: 'created_at', days: policy.integritySnapshotDays },
    ];

    for (const target of targets) {
      if (target.days <= 0) continue;
      const before = cutoff(now, target.days);
      if (options.serverId === undefined) {
        run(`DELETE FROM ${target.table} WHERE ${target.timestampColumn} < ?`, [before], target.table);
      } else {
        run(
          `DELETE FROM ${target.table} WHERE server_id = ? AND ${target.timestampColumn} < ?`,
          [options.serverId, before],
          target.table,
        );
      }
    }
  });

  return {
    dryRun,
    scope: options.scope,
    deleted,
    total: Object.values(deleted).reduce((sum, count) => sum + count, 0),
  };
}

export interface StorageUsage {
  readonly table: string;
  readonly rows: number;
}

/** Row counts per table, for reporting what is being kept. */
export function describeStorage(driver: DatabaseDriver, serverId?: string): StorageUsage[] {
  const tables = [
    'servers',
    'scan_runs',
    'resources',
    'resource_files',
    'dependencies',
    'findings',
    'baselines',
    'baseline_resources',
    'baseline_findings',
    'performance_samples',
    'integrity_snapshots',
    'integrity_entries',
    'incidents',
    'incident_events',
  ];

  const scoped = new Set(['scan_runs', 'resources', 'dependencies', 'findings', 'baselines', 'performance_samples', 'integrity_snapshots', 'incidents', 'servers']);

  return tables.map((table) => {
    const usesServerId = serverId !== undefined && scoped.has(table);
    const sql = usesServerId
      ? `SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'servers' ? 'id' : 'server_id'} = ?`
      : `SELECT COUNT(*) AS count FROM ${table}`;
    const row = usesServerId
      ? driver.prepare(sql).get<{ count: number }>(serverId)
      : driver.prepare(sql).get<{ count: number }>();
    return { table, rows: row?.count ?? 0 };
  });
}
