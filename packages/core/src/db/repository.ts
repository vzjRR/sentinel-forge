/**
 * Local storage for scan results.
 *
 * All writes for one scan happen in a single transaction: a partially recorded
 * scan would make the history unreliable, and history is what later gates
 * correlate against.
 *
 * Upserts key on the natural identity of each row (server path, resource name
 * within a server) so re-scanning the same server updates rather than
 * duplicates, and `first_seen_at` keeps its original value.
 */

import type { Finding, ServerFingerprint } from '@sentinel-forge/shared';
import type { DatabaseDriver } from './driver.js';

export interface ScanRunRecord {
  readonly id: string;
  readonly serverId: string;
  readonly command: string;
  readonly productVersion: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  readonly durationMs?: number;
  readonly resourceCount?: number;
  readonly findingCount?: number;
  readonly incompleteReason?: string;
}

export interface ResourceRecord {
  readonly id: string;
  readonly serverId: string;
  readonly name: string;
  readonly path: string;
  readonly manifestKind: string;
  readonly version?: string;
  readonly fileCount: number;
}

export interface ResourceFileRecord {
  readonly resourceId: string;
  readonly path: string;
  readonly size: number;
  readonly hash: string;
  readonly modifiedAt: string;
  readonly fileType: string;
}

export interface DependencyRecord {
  readonly serverId: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly resolved: boolean;
  readonly declaredIn?: string;
}

export function upsertServer(driver: DatabaseDriver, server: ServerFingerprint, now: string): void {
  driver
    .prepare(
      `INSERT INTO servers (id, path, config_path, fingerprint, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         path = excluded.path,
         config_path = excluded.config_path,
         fingerprint = excluded.fingerprint,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(server.id, server.path, server.configPath ?? null, server.fingerprint, now, now);
}

export function insertScanRun(driver: DatabaseDriver, run: ScanRunRecord): void {
  driver
    .prepare(
      `INSERT INTO scan_runs (id, server_id, command, product_version, started_at, finished_at, status,
                              duration_ms, resource_count, finding_count, incomplete_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.serverId,
      run.command,
      run.productVersion,
      run.startedAt,
      run.finishedAt ?? null,
      run.status,
      run.durationMs ?? null,
      run.resourceCount ?? null,
      run.findingCount ?? null,
      run.incompleteReason ?? null,
    );
}

export function upsertResource(driver: DatabaseDriver, resource: ResourceRecord, now: string): void {
  driver
    .prepare(
      `INSERT INTO resources (id, server_id, name, path, manifest_kind, version, file_count, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         path = excluded.path,
         manifest_kind = excluded.manifest_kind,
         version = excluded.version,
         file_count = excluded.file_count,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(
      resource.id,
      resource.serverId,
      resource.name,
      resource.path,
      resource.manifestKind,
      resource.version ?? null,
      resource.fileCount,
      now,
      now,
    );
}

export function replaceResourceFiles(
  driver: DatabaseDriver,
  resourceId: string,
  files: readonly ResourceFileRecord[],
  now: string,
): void {
  driver.prepare('DELETE FROM resource_files WHERE resource_id = ?').run(resourceId);
  const statement = driver.prepare(
    `INSERT INTO resource_files (resource_id, path, size_bytes, hash, hash_algorithm, modified_at, file_type, recorded_at)
     VALUES (?, ?, ?, ?, 'sha256', ?, ?, ?)`,
  );
  for (const file of files) {
    statement.run(resourceId, file.path, file.size, file.hash, file.modifiedAt, file.fileType, now);
  }
}

export function replaceDependencies(
  driver: DatabaseDriver,
  serverId: string,
  dependencies: readonly DependencyRecord[],
  now: string,
): void {
  driver.prepare('DELETE FROM dependencies WHERE server_id = ?').run(serverId);
  const statement = driver.prepare(
    `INSERT INTO dependencies (server_id, from_resource, to_resource, kind, resolved, declared_in, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const dependency of dependencies) {
    statement.run(
      serverId,
      dependency.from,
      dependency.to,
      dependency.kind,
      dependency.resolved,
      dependency.declaredIn ?? null,
      now,
    );
  }
}

export function insertFindings(
  driver: DatabaseDriver,
  scanRunId: string,
  serverId: string,
  findings: readonly Finding[],
): void {
  const statement = driver.prepare(
    `INSERT INTO findings (id, scan_run_id, server_id, rule_id, category, severity, confidence, title, summary,
                           recommendation, resource_name, file_path, line, evidence_json, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       scan_run_id = excluded.scan_run_id,
       severity = excluded.severity,
       confidence = excluded.confidence,
       evidence_json = excluded.evidence_json,
       created_at = excluded.created_at`,
  );

  for (const finding of findings) {
    statement.run(
      finding.id,
      scanRunId,
      serverId,
      finding.ruleId,
      finding.category,
      finding.severity,
      finding.confidence,
      finding.title,
      finding.summary,
      finding.recommendation,
      finding.resource ?? null,
      finding.file ?? null,
      finding.line ?? null,
      // Evidence is already redacted by the finding builder.
      JSON.stringify(finding.evidence),
      finding.metadata === undefined ? null : JSON.stringify(finding.metadata),
      finding.timestamp,
    );
  }
}

export interface StoredScanSummary {
  readonly runId: string;
  readonly startedAt: string;
  readonly status: string;
  readonly findingCount: number | null;
  readonly resourceCount: number | null;
}

export function listScanRuns(driver: DatabaseDriver, serverId: string, limit = 20): StoredScanSummary[] {
  return driver
    .prepare(
      `SELECT id AS runId, started_at AS startedAt, status, finding_count AS findingCount,
              resource_count AS resourceCount
       FROM scan_runs WHERE server_id = ? ORDER BY started_at DESC LIMIT ?`,
    )
    .all<StoredScanSummary>(serverId, limit);
}

export function findServerByPath(driver: DatabaseDriver, path: string): { id: string; path: string } | undefined {
  return driver.prepare('SELECT id, path FROM servers WHERE path = ?').get<{ id: string; path: string }>(path);
}
