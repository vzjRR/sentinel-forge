import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentinelNotImplementedError, SentinelSecurityError } from '@sentinel-forge/core';
import { REPORT_SCHEMA_VERSION, type SentinelReport } from '@sentinel-forge/shared';
import { renderReport, writeReport } from './write.js';

const REPORT: SentinelReport = {
  schemaVersion: REPORT_SCHEMA_VERSION,
  generatedAt: '2026-01-01T00:00:00.000Z',
  metadata: {
    generatedAt: '2026-01-01T00:00:00.000Z',
    productVersion: '0.1.0',
    command: 'report',
    durationMs: 1,
    hostPlatform: 'linux-x64',
    nodeVersion: 'v22.22.2',
  },
  server: {
    id: 'srv_1',
    path: '/srv/fixture',
    resourceRoots: ['resources'],
    resourceCount: 0,
    fingerprint: 'abc',
    scannedAt: '2026-01-01T00:00:00.000Z',
  },
  resources: [],
  findings: [],
  incidents: [],
  limitations: ['Findings are indicators.'],
};

describe('report writing', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'sentinel-report-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('writes JSON to the default location', async () => {
    const written = await writeReport({ report: REPORT, format: 'json', outputDirectory: workspace });
    expect(written.path).toBe(path.join(workspace, 'sentinel-report.json'));
    expect(JSON.parse(await readFile(written.path, 'utf8'))).toMatchObject({ schemaVersion: REPORT_SCHEMA_VERSION });
  });

  it('writes Markdown with the matching extension', async () => {
    const written = await writeReport({ report: REPORT, format: 'markdown', outputDirectory: workspace });
    expect(written.path.endsWith('.md')).toBe(true);
    expect(await readFile(written.path, 'utf8')).toContain('# Sentinel Forge report');
  });

  it('creates the output directory when it does not exist', async () => {
    const nested = path.join(workspace, 'a', 'b');
    const written = await writeReport({ report: REPORT, format: 'json', outputDirectory: nested });
    expect(written.bytes).toBeGreaterThan(0);
  });

  it('honours an explicit output path', async () => {
    const target = path.join(workspace, 'custom-name.json');
    const written = await writeReport({ report: REPORT, format: 'json', outputDirectory: workspace, outputPath: target });
    expect(written.path).toBe(target);
  });

  it('reports HTML as not implemented rather than rendering a placeholder', () => {
    expect(() => renderReport(REPORT, 'html')).toThrow(SentinelNotImplementedError);
    expect(() => renderReport(REPORT, 'html')).toThrow(/GATE 6/);
  });

  it('refuses an output path that escapes its own directory through a link', async () => {
    const { mkdir, symlink } = await import('node:fs/promises');
    const outside = path.join(workspace, 'outside');
    const inside = path.join(workspace, 'inside');
    await mkdir(outside, { recursive: true });
    await mkdir(inside, { recursive: true });
    await symlink(outside, path.join(inside, 'escape'), 'dir');

    await expect(
      writeReport({
        report: REPORT,
        format: 'json',
        outputDirectory: inside,
        outputPath: path.join(inside, 'escape', 'report.json'),
      }),
    ).rejects.toBeInstanceOf(SentinelSecurityError);
  });
});
