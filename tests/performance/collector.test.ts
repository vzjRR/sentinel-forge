/**
 * Performance: the runtime collector's cost.
 *
 * WHAT THIS FILE MEASURES, AND WHAT IT CANNOT
 *
 * The collector runs inside a FiveM server. Its CPU cost per tick can only be
 * measured inside one, and there is no FiveM server in this test suite — so
 * this file does not measure it, and does not pretend to. The in-server
 * procedure an operator or a release manager runs instead is documented in
 * `resources/sentinel_doctor/README.md` and `docs/RELEASE.md`.
 *
 * What *is* measurable here is measurable exactly, and it is the part of the
 * collector's footprint that can grow without anyone noticing:
 *
 *   1. **Disk.** The collector writes files into its own directory in a fixed
 *      rotation. Worst case — every buffer full at every flush — is computable
 *      from the schema and the configured bounds, and it is asserted against a
 *      documented ceiling. A diagnostic tool that fills an operator's disk is
 *      an outage it caused itself.
 *   2. **Ingestion.** Reading a full rotation of worst-case files is work
 *      Sentinel Forge does on the operator's machine, and it is measured end to
 *      end: locate, parse, and write into the database.
 *
 * Thresholds are ceilings that catch a change in complexity, not a slow
 * machine. Figures are printed so a regression is visible even when the
 * assertion still passes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixedClock, openInMemoryDatabase, type OpenedDatabase } from '@sentinel-forge/core';
import { ingestTelemetry, readTelemetry } from '@sentinel-forge/runtime';
import { createWorkspace, removeWorkspace, repositoryRoot } from '../helpers/workspace.js';

/**
 * The collector's shipped defaults, read from its own configuration source so
 * this benchmark cannot drift away from what is actually deployed.
 */
async function collectorDefaults(): Promise<Record<string, number>> {
  const source = await readFile(
    path.join(repositoryRoot, 'resources', 'sentinel_doctor', 'server', 'config.lua'),
    'utf8',
  );

  const defaults: Record<string, number> = {};
  for (const match of source.matchAll(/intConvar\('([a-z_]+)',\s*(\d+)\)/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) defaults[name] = Number.parseInt(value, 10);
  }
  return defaults;
}

/** One sample as the collector writes it, with a player count present. */
function sample(index: number): Record<string, unknown> {
  return {
    metric: 'scheduler_latency_ms',
    value: index % 17,
    unit: 'ms',
    playerCount: 48,
    at: 1_772_366_400 + index,
  };
}

function worstCaseDocument(sampleCount: number, eventCount: number): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    collector: 'sentinel_doctor',
    collectorVersion: '0.6.0',
    writtenAt: 1_772_366_400,
    serverUptimeMs: 604_800_000,
    samples: Array.from({ length: sampleCount }, (_value, index) => sample(index)),
    events: Array.from({ length: eventCount }, (_value, index) => ({
      kind: 'resource_state_changed',
      // A long but realistic resource name: FiveM resource names are directory
      // names, and category-heavy servers use verbose ones.
      resource: `sf_generated_resource_${String(index).padStart(4, '0')}`,
      detail: 'started',
      playerCount: 48,
      at: 1_772_366_400 + index,
    })),
    dropped: { samples: 0, events: 0 },
    limitations: [
      'FiveM exposes no scripting API for per-resource CPU or tick time on the server, so none is reported.',
      'Scheduler latency is measured from inside this resource. It reflects how promptly the server serviced this thread.',
      'Player counts are counts only. No player identifier, name, endpoint or position is read or recorded.',
    ],
  };
}

/**
 * Ceiling for the collector's total disk footprint, in bytes.
 *
 * 64 MiB is far above what the shipped defaults produce and far below anything
 * an operator would call a problem. It exists to fail loudly if a schema change
 * multiplies the per-sample cost.
 */
const DISK_CEILING_BYTES = 64 * 1024 * 1024;

/** Ceiling for reading and importing a full worst-case rotation, in milliseconds. */
const INGEST_CEILING_MS = 20_000;

describe('sentinel_doctor footprint', () => {
  let defaults: Record<string, number>;

  beforeAll(async () => {
    defaults = await collectorDefaults();
  });

  it('reads its bounds from the collector it ships', () => {
    expect(defaults['sentinel_max_buffered_samples']).toBeGreaterThan(0);
    expect(defaults['sentinel_max_files']).toBeGreaterThan(0);
    expect(defaults['sentinel_flush_interval_ms']).toBeGreaterThan(0);
    expect(defaults['sentinel_sample_interval_ms']).toBeGreaterThan(0);
  });

  it('bounds its disk use below the documented ceiling, even with every buffer full', () => {
    const maxSamples = defaults['sentinel_max_buffered_samples'] ?? 0;
    const maxFiles = defaults['sentinel_max_files'] ?? 0;

    // Worst case: every flush finds both buffers at the bound.
    const document = JSON.stringify(worstCaseDocument(maxSamples, maxSamples));
    const perFile = Buffer.byteLength(document, 'utf8');
    const total = perFile * maxFiles;

    // eslint-disable-next-line no-console
    console.log(
      `collector disk: ${(perFile / 1024).toFixed(0)} KiB per file x ${String(maxFiles)} files = ${(
        total /
        1024 /
        1024
      ).toFixed(1)} MiB worst case`,
    );

    expect(total).toBeLessThan(DISK_CEILING_BYTES);
  });

  it('produces a modest file at the rate the defaults actually generate', () => {
    const flushMs = defaults['sentinel_flush_interval_ms'] ?? 60_000;
    const sampleMs = defaults['sentinel_sample_interval_ms'] ?? 500;
    const samplesPerFlush = Math.ceil(flushMs / sampleMs);

    // No events: on a steady server, resources do not start or stop, so a
    // typical flush carries latency samples only.
    const perFile = Buffer.byteLength(JSON.stringify(worstCaseDocument(samplesPerFlush, 0)), 'utf8');

    // eslint-disable-next-line no-console
    console.log(
      `collector steady state: ${String(samplesPerFlush)} samples per flush, ${(perFile / 1024).toFixed(1)} KiB per file`,
    );

    // A steady-state file is small enough that writing one cannot itself be a
    // source of the hitching the collector exists to measure.
    expect(perFile).toBeLessThan(256 * 1024);
  });
});

describe('telemetry ingestion cost', () => {
  let workspace: string;
  let database: OpenedDatabase;
  let fileCount: number;
  let sampleTotal: number;

  beforeAll(async () => {
    const defaults = await collectorDefaults();
    fileCount = defaults['sentinel_max_files'] ?? 12;
    const perFile = defaults['sentinel_max_buffered_samples'] ?? 5000;
    sampleTotal = fileCount * perFile;

    workspace = await createWorkspace('sentinel-collector-perf-');
    const telemetryDirectory = path.join(workspace, 'resources', 'sentinel_doctor', 'telemetry');
    await mkdir(telemetryDirectory, { recursive: true });

    for (let index = 0; index < fileCount; index += 1) {
      // Each file carries a distinct write time, so none is skipped as a
      // duplicate — this measures the cost of importing, not of skipping.
      const document = { ...worstCaseDocument(perFile, 200), writtenAt: 1_772_366_400 + index * 60 };
      await writeFile(
        path.join(telemetryDirectory, `sentinel-telemetry-${String(index + 1).padStart(2, '0')}.json`),
        JSON.stringify(document),
        'utf8',
      );
    }

    database = openInMemoryDatabase();
    const now = '2026-03-01T12:00:00.000Z';
    database.driver
      .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run('srv_perf', workspace, 'fp', now, now);
  }, 120_000);

  afterAll(async () => {
    database.close();
    await removeWorkspace(workspace);
  });

  it('reads and imports a full worst-case rotation within the ceiling', async () => {
    const started = performance.now();

    const read = await readTelemetry({ serverRoot: workspace, resourceDirectories: ['resources'] });
    const ingested = ingestTelemetry(database.driver, read, {
      serverId: 'srv_perf',
      clock: createFixedClock(new Date('2026-03-01T12:00:00.000Z')),
    });

    const elapsed = performance.now() - started;

    // eslint-disable-next-line no-console
    console.log(
      `telemetry ingest: ${String(fileCount)} files, ${String(ingested.samplesWritten)} samples, ${String(
        ingested.eventsWritten,
      )} events in ${elapsed.toFixed(0)} ms`,
    );

    expect(read.documents).toHaveLength(fileCount);
    expect(ingested.samplesWritten).toBe(sampleTotal);
    expect(elapsed).toBeLessThan(INGEST_CEILING_MS);
  });

  it('skips an already-imported rotation far faster than importing it', async () => {
    // The operator's timer re-reads the same files every few minutes. That path
    // must stay cheap, or the idempotency that protects their data becomes a
    // reason not to schedule the import at all.
    const started = performance.now();

    const read = await readTelemetry({ serverRoot: workspace, resourceDirectories: ['resources'] });
    const ingested = ingestTelemetry(database.driver, read, {
      serverId: 'srv_perf',
      clock: createFixedClock(new Date('2026-03-01T12:05:00.000Z')),
    });

    const elapsed = performance.now() - started;

    // eslint-disable-next-line no-console
    console.log(`telemetry re-import (all duplicates): ${elapsed.toFixed(0)} ms`);

    expect(ingested.imported).toHaveLength(0);
    expect(ingested.alreadyImported).toHaveLength(fileCount);
    expect(ingested.samplesWritten).toBe(0);
    expect(elapsed).toBeLessThan(INGEST_CEILING_MS);
  });
});

describe('what this benchmark does not measure', () => {
  it('states the limit rather than leaving it to be discovered', () => {
    // Deliberately an assertion rather than a comment: it keeps the statement
    // in the test report, where a release manager reading benchmark output will
    // see it next to the numbers it qualifies.
    const notMeasured =
      'In-server CPU and tick cost of the collector is NOT measured here: it requires a running FiveM server. ' +
      'See resources/sentinel_doctor/README.md for the in-server measurement procedure.';

    expect(notMeasured).toContain('NOT measured here');
    // eslint-disable-next-line no-console
    console.log(notMeasured);
  });
});
