import { describe, expect, it } from 'vitest';
import { openInMemoryDatabase, type OpenedDatabase } from '@sentinel-forge/core';
import type { Finding } from '@sentinel-forge/shared';
import {
  captureBaseline,
  deleteBaseline,
  findBaseline,
  hashResourceInventory,
  listBaselines,
  loadBaselineFindings,
  loadBaselineResources,
  loadSamples,
  recordSamples,
} from './baseline.js';

const NOW = '2026-01-01T00:00:00.000Z';

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

const FINDING: Finding = {
  id: 'fnd_1',
  ruleId: 'DEP-MISSING-001',
  category: 'DEPENDENCIES',
  severity: 'HIGH',
  confidence: 0.95,
  title: 'Declared dependency was not found',
  summary: 'Summary.',
  recommendation: 'Recommendation.',
  evidence: [{ kind: 'RELATIONSHIP', description: 'Unresolved edge.' }],
  resource: 'sf_shop',
  timestamp: NOW,
};

function capture(database: OpenedDatabase, label: string, overrides: Record<string, unknown> = {}): ReturnType<typeof captureBaseline> {
  return captureBaseline(database.driver, {
    id: `bl_${label}`,
    serverId: 'srv_1',
    label,
    serverFingerprint: 'fp',
    configFingerprint: 'cfg',
    resources: [
      { resource: 'sf_core', path: 'resources/sf_core', version: '1.0.0', fileCount: 3, totalBytes: 300, contentHash: 'hash-a' },
      { resource: 'sf_shop', path: 'resources/sf_shop', fileCount: 2, totalBytes: 200, contentHash: 'hash-b' },
    ],
    findings: [FINDING],
    health: {
      score: 75,
      categories: [],
      primaryReasons: [],
      complete: false,
    },
    createdAt: NOW,
    ...overrides,
  });
}

describe('baselines', () => {
  it('records a baseline with its resources and findings', () => {
    withDatabase((database) => {
      const record = capture(database, 'before');
      expect(record).toMatchObject({ label: 'before', resourceCount: 2, findingCount: 1, healthScore: 75 });

      expect(loadBaselineResources(database.driver, record.id).map((entry) => entry.resource)).toEqual([
        'sf_core',
        'sf_shop',
      ]);
      expect(loadBaselineFindings(database.driver, record.id)[0]).toMatchObject({
        findingId: 'fnd_1',
        ruleId: 'DEP-MISSING-001',
      });
    });
  });

  it('records zero samples when nothing collected any', () => {
    // The honest answer for a build with no runtime collector. A baseline must
    // never carry an estimated timing value.
    withDatabase((database) => {
      expect(capture(database, 'before').sampleCount).toBe(0);
    });
  });

  it('lists baselines newest first', () => {
    withDatabase((database) => {
      capture(database, 'first');
      capture(database, 'second', { createdAt: '2026-02-01T00:00:00.000Z' });
      expect(listBaselines(database.driver, 'srv_1').map((baseline) => baseline.label)).toEqual(['second', 'first']);
    });
  });

  it('finds a baseline by label and reports a missing one as undefined', () => {
    withDatabase((database) => {
      capture(database, 'before');
      expect(findBaseline(database.driver, 'srv_1', 'before')?.label).toBe('before');
      expect(findBaseline(database.driver, 'srv_1', 'nope')).toBeUndefined();
    });
  });

  it('deletes a baseline and everything recorded with it', () => {
    withDatabase((database) => {
      const record = capture(database, 'before');
      expect(deleteBaseline(database.driver, 'srv_1', 'before')).toBe(true);
      expect(loadBaselineResources(database.driver, record.id)).toEqual([]);
      expect(loadBaselineFindings(database.driver, record.id)).toEqual([]);
      expect(deleteBaseline(database.driver, 'srv_1', 'before')).toBe(false);
    });
  });

  it('rejects a second baseline with the same label for one server', () => {
    withDatabase((database) => {
      capture(database, 'before');
      expect(() => capture(database, 'before')).toThrow();
    });
  });

  it('hashes a resource inventory stably and detects any change', () => {
    const files = [
      { path: 'a.lua', size: 10, hash: 'h1' },
      { path: 'b.lua', size: 20, hash: 'h2' },
    ];
    expect(hashResourceInventory(files)).toBe(hashResourceInventory([...files].reverse()));
    expect(hashResourceInventory(files)).not.toBe(
      hashResourceInventory([{ path: 'a.lua', size: 10, hash: 'changed' }, files[1]!]),
    );
  });

  it('records measured samples and reads them back', () => {
    withDatabase((database) => {
      const written = recordSamples(database.driver, [
        { serverId: 'srv_1', resource: 'sf_core', metric: 'tick', value: 0.2, unit: 'ms', sampledAt: NOW, source: 'test' },
        { serverId: 'srv_1', resource: 'sf_core', metric: 'tick', value: 0.3, unit: 'ms', sampledAt: NOW, source: 'test' },
      ]);
      expect(written).toBe(2);

      const samples = loadSamples(database.driver, { serverId: 'srv_1', resource: 'sf_core' });
      expect(samples.map((sample) => sample.value)).toEqual([0.2, 0.3]);
    });
  });

  it('discards a non-finite sample rather than storing it', () => {
    withDatabase((database) => {
      const written = recordSamples(database.driver, [
        { serverId: 'srv_1', resource: 'sf_core', metric: 'tick', value: Number.NaN, unit: 'ms', sampledAt: NOW, source: 'test' },
      ]);
      expect(written).toBe(0);
      expect(loadSamples(database.driver, { serverId: 'srv_1' })).toEqual([]);
    });
  });

  it('counts recorded samples into a later baseline', () => {
    withDatabase((database) => {
      recordSamples(database.driver, [
        { serverId: 'srv_1', resource: 'sf_core', metric: 'tick', value: 0.2, unit: 'ms', sampledAt: NOW, source: 'test' },
      ]);
      expect(capture(database, 'after').sampleCount).toBe(1);
    });
  });
});
