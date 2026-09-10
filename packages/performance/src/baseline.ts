/**
 * Baselines.
 *
 * A baseline is a recorded answer to "what did this server look like at this
 * moment": its resource inventory with content hashes, its configuration
 * fingerprint, the findings that stood, the health score, and any performance
 * samples that had been collected.
 *
 * The point of recording it is the next question — "what changed?" — which is
 * the one an operator actually asks when something starts going wrong.
 *
 * **Performance samples are only present if something collected them.** No
 * runtime collector exists before GATE 5, so a baseline taken by this build
 * records zero samples and says so. It does not estimate timing from static
 * analysis: an invented number would make every later comparison meaningless.
 */

import { fingerprint, hashString, type DatabaseDriver } from '@sentinel-forge/core';
import type { Finding, HealthScore } from '@sentinel-forge/shared';

export interface BaselineResourceEntry {
  readonly resource: string;
  readonly path: string;
  readonly version?: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  /** Hash over the resource's complete file inventory. */
  readonly contentHash: string;
}

export interface BaselineRecord {
  readonly id: string;
  readonly serverId: string;
  readonly label: string;
  readonly serverFingerprint: string;
  readonly configFingerprint?: string;
  readonly resourceCount: number;
  readonly findingCount: number;
  readonly healthScore?: number;
  /** Player count at capture time. Absent unless a collector supplied it. */
  readonly playerCount?: number;
  readonly sampleCount: number;
  readonly notes?: string;
  readonly createdAt: string;
}

export interface CaptureBaselineInput {
  readonly id: string;
  readonly serverId: string;
  readonly label: string;
  readonly serverFingerprint: string;
  readonly configFingerprint?: string;
  readonly resources: readonly BaselineResourceEntry[];
  readonly findings: readonly Finding[];
  readonly health?: HealthScore;
  readonly notes?: string;
  readonly createdAt: string;
}

/**
 * Content hash for one resource: every file's path, size and hash, combined in
 * a stable order. Two resources whose hashes match are byte-identical.
 */
export function hashResourceInventory(
  files: readonly { readonly path: string; readonly size: number; readonly hash: string }[],
): string {
  return fingerprint(files.map((file) => `${file.path}:${String(file.size)}:${file.hash}`));
}

/** Fingerprint of the configuration text, for detecting configuration drift. */
export function hashConfiguration(source: string): string {
  return hashString(source);
}

/** Writes a baseline and its detail rows in one transaction. */
export function captureBaseline(driver: DatabaseDriver, input: CaptureBaselineInput): BaselineRecord {
  const record: BaselineRecord = {
    id: input.id,
    serverId: input.serverId,
    label: input.label,
    serverFingerprint: input.serverFingerprint,
    ...(input.configFingerprint === undefined ? {} : { configFingerprint: input.configFingerprint }),
    resourceCount: input.resources.length,
    findingCount: input.findings.length,
    ...(input.health === undefined ? {} : { healthScore: input.health.score }),
    // Samples are counted, never estimated. Zero means none were collected.
    sampleCount: countSamples(driver, input.serverId),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    createdAt: input.createdAt,
  };

  driver.transaction(() => {
    driver
      .prepare(
        `INSERT INTO baselines (id, server_id, label, server_fingerprint, config_fingerprint, resource_count,
                                player_count, sample_count, notes, created_at, health_score, finding_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.serverId,
        record.label,
        record.serverFingerprint,
        record.configFingerprint ?? null,
        record.resourceCount,
        record.playerCount ?? null,
        record.sampleCount,
        record.notes ?? null,
        record.createdAt,
        record.healthScore ?? null,
        record.findingCount,
      );

    const resourceStatement = driver.prepare(
      `INSERT INTO baseline_resources (baseline_id, resource_name, path, version, file_count, total_bytes, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const resource of input.resources) {
      resourceStatement.run(
        record.id,
        resource.resource,
        resource.path,
        resource.version ?? null,
        resource.fileCount,
        resource.totalBytes,
        resource.contentHash,
      );
    }

    const findingStatement = driver.prepare(
      `INSERT INTO baseline_findings (baseline_id, finding_id, rule_id, severity, confidence, resource_name, file_path, line, title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const finding of input.findings) {
      findingStatement.run(
        record.id,
        finding.id,
        finding.ruleId,
        finding.severity,
        finding.confidence,
        finding.resource ?? null,
        finding.file ?? null,
        finding.line ?? null,
        finding.title,
      );
    }
  });

  return record;
}

function countSamples(driver: DatabaseDriver, serverId: string): number {
  const row = driver
    .prepare('SELECT COUNT(*) AS count FROM performance_samples WHERE server_id = ?')
    .get<{ count: number }>(serverId);
  return row?.count ?? 0;
}

interface BaselineRow {
  readonly id: string;
  readonly serverId: string;
  readonly label: string;
  readonly serverFingerprint: string;
  readonly configFingerprint: string | null;
  readonly resourceCount: number;
  readonly playerCount: number | null;
  readonly sampleCount: number;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly healthScore: number | null;
  readonly findingCount: number;
}

const BASELINE_COLUMNS = `id, server_id AS serverId, label, server_fingerprint AS serverFingerprint,
  config_fingerprint AS configFingerprint, resource_count AS resourceCount, player_count AS playerCount,
  sample_count AS sampleCount, notes, created_at AS createdAt, health_score AS healthScore,
  finding_count AS findingCount`;

function toRecord(row: BaselineRow): BaselineRecord {
  return {
    id: row.id,
    serverId: row.serverId,
    label: row.label,
    serverFingerprint: row.serverFingerprint,
    ...(row.configFingerprint === null ? {} : { configFingerprint: row.configFingerprint }),
    resourceCount: row.resourceCount,
    findingCount: row.findingCount,
    ...(row.healthScore === null ? {} : { healthScore: row.healthScore }),
    ...(row.playerCount === null ? {} : { playerCount: row.playerCount }),
    sampleCount: row.sampleCount,
    ...(row.notes === null ? {} : { notes: row.notes }),
    createdAt: row.createdAt,
  };
}

export function listBaselines(driver: DatabaseDriver, serverId: string): BaselineRecord[] {
  return driver
    .prepare(`SELECT ${BASELINE_COLUMNS} FROM baselines WHERE server_id = ? ORDER BY created_at DESC`)
    .all<BaselineRow>(serverId)
    .map(toRecord);
}

export function findBaseline(driver: DatabaseDriver, serverId: string, label: string): BaselineRecord | undefined {
  const row = driver
    .prepare(`SELECT ${BASELINE_COLUMNS} FROM baselines WHERE server_id = ? AND label = ?`)
    .get<BaselineRow>(serverId, label);
  return row === undefined ? undefined : toRecord(row);
}

export function loadBaselineResources(driver: DatabaseDriver, baselineId: string): BaselineResourceEntry[] {
  return driver
    .prepare(
      `SELECT resource_name AS resource, path, version, file_count AS fileCount, total_bytes AS totalBytes,
              content_hash AS contentHash
       FROM baseline_resources WHERE baseline_id = ? ORDER BY resource_name`,
    )
    .all<{
      resource: string;
      path: string;
      version: string | null;
      fileCount: number;
      totalBytes: number;
      contentHash: string;
    }>(baselineId)
    .map((row) => ({
      resource: row.resource,
      path: row.path,
      ...(row.version === null ? {} : { version: row.version }),
      fileCount: row.fileCount,
      totalBytes: row.totalBytes,
      contentHash: row.contentHash,
    }));
}

export interface BaselineFindingEntry {
  readonly findingId: string;
  readonly ruleId: string;
  readonly severity: string;
  readonly confidence: number;
  readonly resource?: string;
  readonly file?: string;
  readonly line?: number;
  readonly title: string;
}

export function loadBaselineFindings(driver: DatabaseDriver, baselineId: string): BaselineFindingEntry[] {
  return driver
    .prepare(
      `SELECT finding_id AS findingId, rule_id AS ruleId, severity, confidence, resource_name AS resource,
              file_path AS file, line, title
       FROM baseline_findings WHERE baseline_id = ? ORDER BY finding_id`,
    )
    .all<{
      findingId: string;
      ruleId: string;
      severity: string;
      confidence: number;
      resource: string | null;
      file: string | null;
      line: number | null;
      title: string;
    }>(baselineId)
    .map((row) => ({
      findingId: row.findingId,
      ruleId: row.ruleId,
      severity: row.severity,
      confidence: row.confidence,
      ...(row.resource === null ? {} : { resource: row.resource }),
      ...(row.file === null ? {} : { file: row.file }),
      ...(row.line === null ? {} : { line: row.line }),
      title: row.title,
    }));
}

export function deleteBaseline(driver: DatabaseDriver, serverId: string, label: string): boolean {
  const result = driver.prepare('DELETE FROM baselines WHERE server_id = ? AND label = ?').run(serverId, label);
  return result.changes > 0;
}

/** Records measured performance samples. Used by the runtime collector (GATE 5). */
export interface PerformanceSampleInput {
  readonly serverId: string;
  readonly baselineId?: string;
  readonly resource: string;
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly playerCount?: number;
  readonly sampledAt: string;
  /** Which collector produced the sample, so provenance stays auditable. */
  readonly source: string;
}

export function recordSamples(driver: DatabaseDriver, samples: readonly PerformanceSampleInput[]): number {
  if (samples.length === 0) return 0;

  const statement = driver.prepare(
    `INSERT INTO performance_samples (server_id, baseline_id, resource_name, metric, value, unit, player_count, sampled_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return driver.transaction(() => {
    let written = 0;
    for (const sample of samples) {
      if (!Number.isFinite(sample.value)) continue;
      statement.run(
        sample.serverId,
        sample.baselineId ?? null,
        sample.resource,
        sample.metric,
        sample.value,
        sample.unit,
        sample.playerCount ?? null,
        sample.sampledAt,
        sample.source,
      );
      written += 1;
    }
    return written;
  });
}

export interface SampleQuery {
  readonly serverId: string;
  readonly baselineId?: string;
  readonly resource?: string;
  readonly metric?: string;
  readonly since?: string;
  readonly until?: string;
}

/**
 * Reads samples in a stable order.
 *
 * Ordering by timestamp alone is not deterministic: a collector can record
 * several samples in the same millisecond, and two runs would then summarise
 * them in different orders. The row id breaks the tie.
 */
export function loadSamples(driver: DatabaseDriver, query: SampleQuery): { resource: string; metric: string; unit: string; value: number; playerCount: number | null }[] {
  const conditions = ['server_id = ?'];
  const parameters: (string | number)[] = [query.serverId];

  if (query.baselineId !== undefined) {
    conditions.push('baseline_id = ?');
    parameters.push(query.baselineId);
  }
  if (query.resource !== undefined) {
    conditions.push('resource_name = ?');
    parameters.push(query.resource);
  }
  if (query.metric !== undefined) {
    conditions.push('metric = ?');
    parameters.push(query.metric);
  }
  if (query.since !== undefined) {
    conditions.push('sampled_at >= ?');
    parameters.push(query.since);
  }
  if (query.until !== undefined) {
    conditions.push('sampled_at <= ?');
    parameters.push(query.until);
  }

  return driver
    .prepare(
      `SELECT resource_name AS resource, metric, unit, value, player_count AS playerCount
       FROM performance_samples WHERE ${conditions.join(' AND ')} ORDER BY sampled_at, id`,
    )
    .all<{ resource: string; metric: string; unit: string; value: number; playerCount: number | null }>(...parameters);
}
