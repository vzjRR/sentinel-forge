import { describe, expect, it } from 'vitest';
import { openInMemoryDatabase, type OpenedDatabase } from '@sentinel-forge/core';
import {
  createSnapshot,
  deleteSnapshot,
  findSnapshot,
  listSnapshots,
  loadEntries,
  snapshotHashOf,
  type IntegrityEntry,
} from './snapshot.js';

const NOW = '2026-01-01T00:00:00.000Z';

function entry(path: string, hash: string, overrides: Partial<IntegrityEntry> = {}): IntegrityEntry {
  return { path, resource: 'sf_core', sizeBytes: 100, hash, modifiedAt: NOW, fileType: 'lua', ...overrides };
}

function withDatabase<T>(work: (database: OpenedDatabase) => T): T {
  const database = openInMemoryDatabase();
  try {
    database.driver
      .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run('srv_1', '/opt/fxserver', 'fp', NOW, NOW);
    return work(database);
  } finally {
    database.close();
  }
}

describe('integrity snapshots', () => {
  it('records a snapshot with its entries', () => {
    withDatabase((database) => {
      const snapshot = createSnapshot(database.driver, {
        serverId: 'srv_1',
        label: 'before',
        entries: [entry('a.lua', 'h1'), entry('b.lua', 'h2')],
        createdAt: NOW,
      });

      expect(snapshot).toMatchObject({ label: 'before', fileCount: 2, totalBytes: 200 });
      expect(loadEntries(database.driver, snapshot.id).map((row) => row.path)).toEqual(['a.lua', 'b.lua']);
    });
  });

  it('hashes a snapshot stably and detects any content change', () => {
    const entries = [entry('a.lua', 'h1'), entry('b.lua', 'h2')];
    expect(snapshotHashOf(entries)).toBe(snapshotHashOf([...entries].reverse()));
    expect(snapshotHashOf(entries)).not.toBe(snapshotHashOf([entry('a.lua', 'changed'), entry('b.lua', 'h2')]));
  });

  it('produces the same hash when only a modification time differs', () => {
    // Content is what matters. A touched file is not a changed file.
    const before = [entry('a.lua', 'h1', { modifiedAt: NOW })];
    const after = [entry('a.lua', 'h1', { modifiedAt: '2026-05-05T00:00:00.000Z' })];
    expect(snapshotHashOf(before)).toBe(snapshotHashOf(after));
  });

  it('lists snapshots newest first and finds one by label', () => {
    withDatabase((database) => {
      createSnapshot(database.driver, { serverId: 'srv_1', label: 'first', entries: [entry('a.lua', 'h1')], createdAt: NOW });
      createSnapshot(database.driver, {
        serverId: 'srv_1',
        label: 'second',
        entries: [entry('a.lua', 'h1')],
        createdAt: '2026-02-01T00:00:00.000Z',
      });

      expect(listSnapshots(database.driver, 'srv_1').map((snapshot) => snapshot.label)).toEqual(['second', 'first']);
      expect(findSnapshot(database.driver, 'srv_1', 'first')?.label).toBe('first');
      expect(findSnapshot(database.driver, 'srv_1', 'nope')).toBeUndefined();
    });
  });

  it('deletes a snapshot and its entries together', () => {
    withDatabase((database) => {
      const snapshot = createSnapshot(database.driver, {
        serverId: 'srv_1',
        label: 'before',
        entries: [entry('a.lua', 'h1')],
        createdAt: NOW,
      });
      expect(deleteSnapshot(database.driver, 'srv_1', 'before')).toBe(true);
      expect(loadEntries(database.driver, snapshot.id)).toEqual([]);
      expect(deleteSnapshot(database.driver, 'srv_1', 'before')).toBe(false);
    });
  });

  it('handles an empty snapshot without failing', () => {
    withDatabase((database) => {
      const snapshot = createSnapshot(database.driver, { serverId: 'srv_1', label: 'empty', entries: [], createdAt: NOW });
      expect(snapshot.fileCount).toBe(0);
      expect(snapshot.totalBytes).toBe(0);
    });
  });
});
