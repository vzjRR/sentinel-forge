import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@sentinel-forge/core';
import { compareSnapshots, toIntegrityFindings } from './compare.js';
import type { IntegrityEntry, IntegritySnapshot } from './snapshot.js';

const clock = createFixedClock(new Date('2026-01-01T00:00:00.000Z'));
const NOW = '2026-01-01T00:00:00.000Z';

function snapshot(id: string, hash: string): IntegritySnapshot {
  return { id, serverId: 'srv_1', label: id, fileCount: 0, totalBytes: 0, snapshotHash: hash, createdAt: NOW };
}

function entry(path: string, hash: string, overrides: Partial<IntegrityEntry> = {}): IntegrityEntry {
  return { path, resource: 'sf_core', sizeBytes: 100, hash, modifiedAt: NOW, fileType: 'lua', ...overrides };
}

function compare(before: IntegrityEntry[], after: IntegrityEntry[]): ReturnType<typeof compareSnapshots> {
  return compareSnapshots(snapshot('before', 'h-before'), snapshot('after', 'h-after'), before, after);
}

describe('integrity comparison', () => {
  it('reports nothing changed for identical snapshots', () => {
    const entries = [entry('a.lua', 'h1'), entry('b.lua', 'h2')];
    const result = compare(entries, entries);
    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.unchangedCount).toBe(2);
  });

  it('detects added, modified and deleted files', () => {
    const result = compare(
      [entry('kept.lua', 'h1'), entry('changed.lua', 'h2'), entry('removed.lua', 'h3')],
      [entry('kept.lua', 'h1'), entry('changed.lua', 'changed'), entry('added.lua', 'h4')],
    );

    expect(result.added.map((change) => change.path)).toEqual(['added.lua']);
    expect(result.modified.map((change) => change.path)).toEqual(['changed.lua']);
    expect(result.deleted.map((change) => change.path)).toEqual(['removed.lua']);
  });

  it('reports a touched file separately from a changed one', () => {
    // Identical content with a new timestamp is not a change to the code, and
    // reporting it as one would bury the changes that matter.
    const result = compare(
      [entry('a.lua', 'h1', { modifiedAt: NOW })],
      [entry('a.lua', 'h1', { modifiedAt: '2026-06-01T00:00:00.000Z' })],
    );
    expect(result.modified).toEqual([]);
    expect(result.touched.map((change) => change.path)).toEqual(['a.lua']);
  });

  it('says what changed about a modified file', () => {
    const result = compare([entry('a.lua', 'h1', { sizeBytes: 100 })], [entry('a.lua', 'h2', { sizeBytes: 250 })]);
    expect(result.modified[0]?.details[0]).toContain('Content hash changed');
    expect(result.modified[0]?.details.some((detail) => detail.includes('Size changed'))).toBe(true);
  });

  it('recognises two identical snapshots by hash', () => {
    const same = compareSnapshots(snapshot('a', 'same'), snapshot('b', 'same'), [], []);
    expect(same.identical).toBe(true);
  });

  it('orders changes by path so two runs read the same', () => {
    const result = compare([], [entry('z.lua', 'h1'), entry('a.lua', 'h2')]);
    expect(result.added.map((change) => change.path)).toEqual(['a.lua', 'z.lua']);
  });
});

describe('INT-CHANGE-001', () => {
  it('produces no finding when nothing changed', () => {
    const comparison = compare([entry('a.lua', 'h1')], [entry('a.lua', 'h1')]);
    expect(toIntegrityFindings({ comparison, clock, beforeLabel: 'before', afterLabel: 'after' })).toEqual([]);
  });

  it('produces one finding per resource, not per file', () => {
    // A resource update touches many files; one finding per file would be noise.
    const before = Array.from({ length: 12 }, (_value, index) => entry(`file${String(index)}.lua`, `h${String(index)}`));
    const after = before.map((file) => ({ ...file, hash: `${file.hash}-changed` }));
    const comparison = compare(before, after);

    const findings = toIntegrityFindings({ comparison, clock, beforeLabel: 'before', afterLabel: 'after' });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.metadata).toMatchObject({ modified: 12 });
  });

  it('reports a change as an observation rather than a defect', () => {
    const comparison = compare([entry('a.lua', 'h1')], [entry('a.lua', 'h2')]);
    const finding = toIntegrityFindings({ comparison, clock, beforeLabel: 'before', afterLabel: 'after' })[0];
    expect(finding?.severity).toBe('INFO');
    expect(finding?.summary).toContain('modified');
    expect(finding?.recommendation).toContain('Confirm the change was expected');
  });

  it('never recommends acting on a file automatically', () => {
    const comparison = compare([entry('a.lua', 'h1')], [entry('a.lua', 'h2')]);
    const finding = toIntegrityFindings({ comparison, clock, beforeLabel: 'before', afterLabel: 'after' })[0];
    expect(finding?.recommendation).not.toMatch(/delete|quarantine|remove the file|restore/i);
  });

  it('carries file hashes as evidence', () => {
    const comparison = compare([entry('a.lua', 'h1')], [entry('a.lua', 'h2')]);
    const finding = toIntegrityFindings({ comparison, clock, beforeLabel: 'before', afterLabel: 'after' })[0];
    expect(finding?.evidence[0]?.kind).toBe('FILE_HASH');
    expect(finding?.evidence[0]?.metadata).toMatchObject({ kind: 'MODIFIED' });
  });

  it('bounds the evidence it attaches for a very large change', () => {
    const before = Array.from({ length: 200 }, (_value, index) => entry(`f${String(index)}.lua`, 'h'));
    const after = before.map((file) => ({ ...file, hash: 'changed' }));
    const finding = toIntegrityFindings({
      comparison: compare(before, after),
      clock,
      beforeLabel: 'before',
      afterLabel: 'after',
    })[0];
    expect(finding?.evidence.length).toBeLessThanOrEqual(25);
  });
});
