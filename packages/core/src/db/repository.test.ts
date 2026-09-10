import { describe, expect, it } from 'vitest';
import type { Finding, ServerFingerprint } from '@sentinel-forge/shared';
import { openInMemoryDatabase } from './open.js';
import {
  findServerByPath,
  insertFindings,
  insertScanRun,
  listScanRuns,
  replaceDependencies,
  replaceResourceFiles,
  upsertResource,
  upsertServer,
} from './repository.js';

const NOW = '2026-01-01T00:00:00.000Z';

const SERVER: ServerFingerprint = {
  id: 'srv_1',
  path: '/opt/fxserver',
  configPath: 'server.cfg',
  resourceRoots: ['resources'],
  resourceCount: 1,
  fingerprint: 'abc123',
  scannedAt: NOW,
};

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
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
    file: 'resources/sf_shop/fxmanifest.lua',
    line: 7,
    timestamp: NOW,
    ...overrides,
  };
}

function withDatabase<T>(work: (database: ReturnType<typeof openInMemoryDatabase>) => T): T {
  const database = openInMemoryDatabase();
  try {
    return work(database);
  } finally {
    database.close();
  }
}

describe('scan storage', () => {
  it('records a server and finds it again by path', () => {
    withDatabase(({ driver }) => {
      upsertServer(driver, SERVER, NOW);
      expect(findServerByPath(driver, '/opt/fxserver')).toMatchObject({ id: 'srv_1' });
    });
  });

  it('updates an existing server without duplicating it, keeping first_seen_at', () => {
    withDatabase(({ driver }) => {
      upsertServer(driver, SERVER, NOW);
      upsertServer(driver, { ...SERVER, fingerprint: 'changed' }, '2026-02-01T00:00:00.000Z');

      const rows = driver
        .prepare('SELECT fingerprint, first_seen_at AS firstSeen, last_seen_at AS lastSeen FROM servers')
        .all<{ fingerprint: string; firstSeen: string; lastSeen: string }>();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fingerprint: 'changed', firstSeen: NOW, lastSeen: '2026-02-01T00:00:00.000Z' });
    });
  });

  it('records scan runs and lists them newest first', () => {
    withDatabase(({ driver }) => {
      upsertServer(driver, SERVER, NOW);
      insertScanRun(driver, {
        id: 'run_1',
        serverId: 'srv_1',
        command: 'scan',
        productVersion: '0.1.0',
        startedAt: NOW,
        status: 'COMPLETED',
        findingCount: 2,
        resourceCount: 5,
      });
      insertScanRun(driver, {
        id: 'run_2',
        serverId: 'srv_1',
        command: 'scan',
        productVersion: '0.1.0',
        startedAt: '2026-02-01T00:00:00.000Z',
        status: 'COMPLETED',
      });

      const runs = listScanRuns(driver, 'srv_1');
      expect(runs.map((run) => run.runId)).toEqual(['run_2', 'run_1']);
      expect(runs[1]?.findingCount).toBe(2);
    });
  });

  it('replaces a resource file inventory rather than accumulating it', () => {
    withDatabase(({ driver }) => {
      upsertServer(driver, SERVER, NOW);
      upsertResource(
        driver,
        { id: 'res_1', serverId: 'srv_1', name: 'sf_core', path: 'resources/sf_core', manifestKind: 'fxmanifest', fileCount: 2 },
        NOW,
      );

      const file = (path: string): Parameters<typeof replaceResourceFiles>[2][number] => ({
        resourceId: 'res_1',
        path,
        size: 10,
        hash: 'a'.repeat(64),
        modifiedAt: NOW,
        fileType: 'lua',
      });

      replaceResourceFiles(driver, 'res_1', [file('a.lua'), file('b.lua')], NOW);
      replaceResourceFiles(driver, 'res_1', [file('a.lua')], NOW);

      const rows = driver.prepare('SELECT path FROM resource_files').all<{ path: string }>();
      expect(rows.map((row) => row.path)).toEqual(['a.lua']);
    });
  });

  it('stores a boolean dependency resolution as an integer', () => {
    withDatabase(({ driver }) => {
      upsertServer(driver, SERVER, NOW);
      replaceDependencies(
        driver,
        'srv_1',
        [{ serverId: 'srv_1', from: 'sf_shop', to: 'sf_inventory', kind: 'DECLARED', resolved: false }],
        NOW,
      );
      const row = driver.prepare('SELECT resolved FROM dependencies').get<{ resolved: number }>();
      expect(row?.resolved).toBe(0);
    });
  });

  it('stores findings with their evidence as JSON', () => {
    withDatabase(({ driver }) => {
      upsertServer(driver, SERVER, NOW);
      insertScanRun(driver, {
        id: 'run_1',
        serverId: 'srv_1',
        command: 'scan',
        productVersion: '0.1.0',
        startedAt: NOW,
        status: 'COMPLETED',
      });
      insertFindings(driver, 'run_1', 'srv_1', [finding()]);

      const row = driver
        .prepare('SELECT rule_id AS ruleId, confidence, evidence_json AS evidenceJson FROM findings')
        .get<{ ruleId: string; confidence: number; evidenceJson: string }>();
      expect(row?.ruleId).toBe('DEP-MISSING-001');
      expect(row?.confidence).toBeCloseTo(0.95);
      expect(JSON.parse(row?.evidenceJson ?? '[]')).toHaveLength(1);
    });
  });

  it('updates a finding seen again in a later run instead of duplicating it', () => {
    withDatabase(({ driver }) => {
      upsertServer(driver, SERVER, NOW);
      for (const runId of ['run_1', 'run_2']) {
        insertScanRun(driver, {
          id: runId,
          serverId: 'srv_1',
          command: 'scan',
          productVersion: '0.1.0',
          startedAt: NOW,
          status: 'COMPLETED',
        });
        insertFindings(driver, runId, 'srv_1', [finding()]);
      }

      const rows = driver.prepare('SELECT scan_run_id AS runId FROM findings').all<{ runId: string }>();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.runId).toBe('run_2');
    });
  });

  it('removes everything recorded about a server when the server row is deleted', () => {
    withDatabase(({ driver }) => {
      upsertServer(driver, SERVER, NOW);
      insertScanRun(driver, {
        id: 'run_1',
        serverId: 'srv_1',
        command: 'scan',
        productVersion: '0.1.0',
        startedAt: NOW,
        status: 'COMPLETED',
      });
      upsertResource(
        driver,
        { id: 'res_1', serverId: 'srv_1', name: 'sf_core', path: 'resources/sf_core', manifestKind: 'fxmanifest', fileCount: 0 },
        NOW,
      );
      insertFindings(driver, 'run_1', 'srv_1', [finding()]);

      driver.prepare('DELETE FROM servers WHERE id = ?').run('srv_1');

      for (const table of ['scan_runs', 'resources', 'findings']) {
        const count = driver.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get<{ count: number }>();
        expect(count?.count, table).toBe(0);
      }
    });
  });
});
