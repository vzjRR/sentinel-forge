/**
 * File integrity snapshots.
 *
 * A snapshot is the answer to "what was on disk at this moment": every file
 * with its size, content hash, modification time and type. Comparing two
 * snapshots answers "what changed since then", which is the anchor for relating
 * a behaviour change to a code change.
 *
 * Integrity tracking reports. It never acts: files are not quarantined, moved,
 * modified or deleted, and no future gate in the MVP changes that.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { deterministicId, fingerprint, type DatabaseDriver } from '@sentinel-forge/core';

export interface IntegrityEntry {
  /** Server-relative POSIX path. */
  readonly path: string;
  readonly resource?: string;
  readonly sizeBytes: number;
  /** SHA-256, lowercase hex. */
  readonly hash: string;
  readonly modifiedAt: string;
  readonly fileType: string;
}

export interface IntegritySnapshot {
  readonly id: string;
  readonly serverId: string;
  readonly label?: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  /** Hash over the whole snapshot, for cheap equality checks. */
  readonly snapshotHash: string;
  readonly createdAt: string;
}

export interface CreateSnapshotInput {
  readonly serverId: string;
  readonly label?: string;
  readonly entries: readonly IntegrityEntry[];
  readonly createdAt: string;
}

export function snapshotHashOf(entries: readonly IntegrityEntry[]): string {
  return fingerprint(entries.map((entry) => `${entry.path}:${String(entry.sizeBytes)}:${entry.hash}`));
}

/** Writes a snapshot and its entries in one transaction. */
export function createSnapshot(driver: DatabaseDriver, input: CreateSnapshotInput): IntegritySnapshot {
  const snapshot: IntegritySnapshot = {
    id: deterministicId('snap', input.serverId, input.label ?? input.createdAt),
    serverId: input.serverId,
    ...(input.label === undefined ? {} : { label: input.label }),
    fileCount: input.entries.length,
    totalBytes: input.entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    snapshotHash: snapshotHashOf(input.entries),
    createdAt: input.createdAt,
  };

  driver.transaction(() => {
    driver
      .prepare(
        `INSERT INTO integrity_snapshots (id, server_id, label, file_count, total_bytes, snapshot_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.serverId,
        snapshot.label ?? null,
        snapshot.fileCount,
        snapshot.totalBytes,
        snapshot.snapshotHash,
        snapshot.createdAt,
      );

    const statement = driver.prepare(
      `INSERT INTO integrity_entries (snapshot_id, resource_name, path, size_bytes, hash, modified_at, file_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const entry of input.entries) {
      statement.run(
        snapshot.id,
        entry.resource ?? null,
        entry.path,
        entry.sizeBytes,
        entry.hash,
        entry.modifiedAt,
        entry.fileType,
      );
    }
  });

  return snapshot;
}

interface SnapshotRow {
  readonly id: string;
  readonly serverId: string;
  readonly label: string | null;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly snapshotHash: string;
  readonly createdAt: string;
}

const SNAPSHOT_COLUMNS = `id, server_id AS serverId, label, file_count AS fileCount, total_bytes AS totalBytes,
  snapshot_hash AS snapshotHash, created_at AS createdAt`;

function toSnapshot(row: SnapshotRow): IntegritySnapshot {
  return {
    id: row.id,
    serverId: row.serverId,
    ...(row.label === null ? {} : { label: row.label }),
    fileCount: row.fileCount,
    totalBytes: row.totalBytes,
    snapshotHash: row.snapshotHash,
    createdAt: row.createdAt,
  };
}

export function listSnapshots(driver: DatabaseDriver, serverId: string, limit = 20): IntegritySnapshot[] {
  return driver
    .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM integrity_snapshots WHERE server_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all<SnapshotRow>(serverId, limit)
    .map(toSnapshot);
}

export function findSnapshot(driver: DatabaseDriver, serverId: string, label: string): IntegritySnapshot | undefined {
  const row = driver
    .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM integrity_snapshots WHERE server_id = ? AND label = ?`)
    .get<SnapshotRow>(serverId, label);
  return row === undefined ? undefined : toSnapshot(row);
}

export function loadEntries(driver: DatabaseDriver, snapshotId: string): IntegrityEntry[] {
  return driver
    .prepare(
      `SELECT path, resource_name AS resource, size_bytes AS sizeBytes, hash, modified_at AS modifiedAt,
              file_type AS fileType
       FROM integrity_entries WHERE snapshot_id = ? ORDER BY path`,
    )
    .all<{
      path: string;
      resource: string | null;
      sizeBytes: number;
      hash: string;
      modifiedAt: string;
      fileType: string;
    }>(snapshotId)
    .map((row) => ({
      path: row.path,
      ...(row.resource === null ? {} : { resource: row.resource }),
      sizeBytes: row.sizeBytes,
      hash: row.hash,
      modifiedAt: row.modifiedAt,
      fileType: row.fileType,
    }));
}

export function deleteSnapshot(driver: DatabaseDriver, serverId: string, label: string): boolean {
  return driver.prepare('DELETE FROM integrity_snapshots WHERE server_id = ? AND label = ?').run(serverId, label).changes > 0;
}
