/**
 * Integration: collector installed → telemetry written → imported → compared.
 *
 * This is the path that makes GATE 5 worth anything: a measurement taken inside
 * a running server reaching the regression engine without being invented,
 * duplicated, or attributed to something that did not produce it.
 *
 * The collector itself is not run — it needs a FiveM server — so its output is
 * written to disk in the exact shape `server/writer.lua` produces, and the rest
 * of the path is exercised for real through the CLI.
 */

import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { createWorkspace, fixturePath, parseJsonOutput, removeWorkspace, runCli } from '../helpers/workspace.js';

const COLLECTOR_VERSION = '0.6.0';

interface TelemetryOptions {
  readonly writtenAt: number;
  readonly latencies: readonly number[];
  readonly events?: readonly { kind: string; resource: string; detail: string }[];
  readonly dropped?: { samples: number; events: number };
}

/** A telemetry document in the shape `server/writer.lua` writes. */
function telemetry(options: TelemetryOptions): string {
  return JSON.stringify({
    schemaVersion: '1.0',
    collector: 'sentinel_doctor',
    collectorVersion: COLLECTOR_VERSION,
    writtenAt: options.writtenAt,
    serverUptimeMs: 3_600_000,
    samples: options.latencies.map((value, index) => ({
      metric: 'scheduler_latency_ms',
      value,
      unit: 'ms',
      playerCount: 32,
      at: options.writtenAt - options.latencies.length + index,
    })),
    events: (options.events ?? []).map((event, index) => ({
      ...event,
      playerCount: 32,
      at: options.writtenAt - index,
    })),
    dropped: options.dropped ?? { samples: 0, events: 0 },
    limitations: [
      'FiveM exposes no scripting API for per-resource CPU or tick time on the server, so none is reported.',
    ],
  });
}

describe('runtime telemetry', () => {
  let workspace: string;
  let server: string;
  let telemetryDirectory: string;

  beforeEach(async () => {
    workspace = await createWorkspace('sentinel-runtime-');
    server = path.join(workspace, 'server');
    await cp(fixturePath('healthy-server'), server, { recursive: true });
    telemetryDirectory = path.join(server, 'resources', 'sentinel_doctor', 'telemetry');
    await runCli(['init', '--server', server], workspace);
  });

  afterEach(async () => {
    await removeWorkspace(workspace);
  });

  async function installCollector(): Promise<void> {
    await mkdir(telemetryDirectory, { recursive: true });
  }

  async function write(name: string, options: TelemetryOptions): Promise<void> {
    await writeFile(path.join(telemetryDirectory, name), telemetry(options), 'utf8');
  }

  it('reports the collector as not installed, and says how to install it', async () => {
    const result = await runCli(['runtime', 'status'], workspace);

    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(result.stdout).toContain('Collector: not installed');
    expect(result.stdout).toContain('ensure sentinel_doctor');
    // The standing limitation is printed whether or not anything was measured.
    expect(result.stdout).toContain('no per-resource timing is collected or reported');
  });

  it('distinguishes an installed collector that has written nothing from one that has', async () => {
    await installCollector();
    const before = await runCli(['runtime', 'status'], workspace);
    expect(before.stdout).toContain('Collector: installed');
    expect(before.stdout).toContain('no telemetry written yet');

    await write('sentinel-telemetry-01.json', { writtenAt: 1_772_366_400, latencies: [2, 3, 4] });
    const after = await runCli(['runtime', 'status'], workspace);
    expect(after.stdout).not.toContain('no telemetry written yet');
    expect(after.stdout).toContain('1 telemetry file(s) on disk');
  });

  it('refuses to import for a server that has never been scanned', async () => {
    await installCollector();
    await write('sentinel-telemetry-01.json', { writtenAt: 1_772_366_400, latencies: [2] });

    const result = await runCli(['runtime', 'import'], workspace);

    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('has not been scanned yet');
    expect(result.stderr).toContain('sentinel scan');
  });

  it('refuses to import when the collector is not installed, rather than reporting zero', async () => {
    await runCli(['scan'], workspace);
    const result = await runCli(['runtime', 'import'], workspace);

    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('not installed');
  });

  it('imports measured samples and observed events', async () => {
    await runCli(['scan'], workspace);
    await installCollector();
    await write('sentinel-telemetry-01.json', {
      writtenAt: 1_772_366_400,
      latencies: [2, 3, 4, 5],
      events: [{ kind: 'resource_started', resource: 'sf_core', detail: 'started' }],
    });

    const result = await runCli(['runtime', 'import', '--json'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.SUCCESS);

    const payload = parseJsonOutput<{ samplesWritten: number; eventsWritten: number; imported: unknown[] }>(result);
    expect(payload.samplesWritten).toBe(4);
    expect(payload.eventsWritten).toBe(1);
    expect(payload.imported).toHaveLength(1);
  });

  it('does not double-count when the same telemetry is imported twice', async () => {
    await runCli(['scan'], workspace);
    await installCollector();
    await write('sentinel-telemetry-01.json', { writtenAt: 1_772_366_400, latencies: [2, 3, 4, 5] });

    await runCli(['runtime', 'import'], workspace);
    const second = await runCli(['runtime', 'import', '--json'], workspace);

    const payload = parseJsonOutput<{ samplesWritten: number; alreadyImported: unknown[] }>(second);
    expect(payload.samplesWritten).toBe(0);
    expect(payload.alreadyImported).toHaveLength(1);

    const status = parseJsonOutput<{ imported: { sampleCount: number } }>(
      await runCli(['runtime', 'status', '--json'], workspace),
    );
    expect(status.imported.sampleCount).toBe(4);
  });

  it('reports what the collector dropped instead of presenting a gap as quiet', async () => {
    await runCli(['scan'], workspace);
    await installCollector();
    await write('sentinel-telemetry-01.json', {
      writtenAt: 1_772_366_400,
      latencies: [2],
      dropped: { samples: 118, events: 4 },
    });

    const result = await runCli(['runtime', 'import'], workspace);
    expect(result.stdout).toContain('118 sample(s), 4 event(s)');
    expect(result.stdout).toContain('buffer was full');
  });

  it('keeps readable telemetry when one file is corrupt, and names the bad file', async () => {
    await runCli(['scan'], workspace);
    await installCollector();
    await write('sentinel-telemetry-01.json', { writtenAt: 1_772_366_400, latencies: [2, 3] });
    await writeFile(path.join(telemetryDirectory, 'sentinel-telemetry-02.json'), '{ truncated', 'utf8');

    const result = await runCli(['runtime', 'import', '--json'], workspace);
    const payload = parseJsonOutput<{ samplesWritten: number; problems: { file: string }[] }>(result);

    expect(payload.samplesWritten).toBe(2);
    expect(payload.problems).toHaveLength(1);
    expect(payload.problems[0]?.file).toContain('sentinel-telemetry-02.json');
  });

  it('refuses telemetry from a newer collector rather than misreading it', async () => {
    await runCli(['scan'], workspace);
    await installCollector();
    await writeFile(
      path.join(telemetryDirectory, 'sentinel-telemetry-01.json'),
      JSON.stringify({ schemaVersion: '2.0', samples: [], events: [] }),
      'utf8',
    );

    const result = await runCli(['runtime', 'import', '--json'], workspace);
    const payload = parseJsonOutput<{ samplesWritten: number; problems: { reason: string }[] }>(result);

    expect(payload.samplesWritten).toBe(0);
    expect(payload.problems[0]?.reason).toContain('not understood by this build');
  });

  it('shows observed events as observations, without inferring a cause', async () => {
    await runCli(['scan'], workspace);
    await installCollector();
    await write('sentinel-telemetry-01.json', {
      writtenAt: 1_772_366_400,
      latencies: [],
      events: [{ kind: 'resource_stopped', resource: 'sf_core', detail: 'stopped' }],
    });
    await runCli(['runtime', 'import'], workspace);

    const result = await runCli(['runtime', 'events'], workspace);
    expect(result.stdout).toContain('resource_stopped');
    expect(result.stdout).toContain('sf_core');
    expect(result.stdout).toContain('why it stopped is not something the collector can');
  });

  it('attaches imported samples to the next baseline, so two windows can be compared', async () => {
    await runCli(['scan'], workspace);
    await installCollector();

    await write('sentinel-telemetry-01.json', { writtenAt: 1_772_366_400, latencies: [2, 2, 3, 2, 3, 2, 2, 3, 2, 3] });
    await runCli(['runtime', 'import'], workspace);

    const before = parseJsonOutput<{ baseline: { sampleCount: number } }>(
      await runCli(['baseline', 'create', 'before', '--json'], workspace),
    );
    expect(before.baseline.sampleCount).toBe(10);

    await write('sentinel-telemetry-02.json', {
      writtenAt: 1_772_370_000,
      latencies: [40, 44, 39, 41, 43, 40, 42, 41, 45, 39],
    });
    await runCli(['runtime', 'import'], workspace);

    const after = parseJsonOutput<{ baseline: { sampleCount: number } }>(
      await runCli(['baseline', 'create', 'after', '--json'], workspace),
    );
    // The second baseline claims only the samples collected since the first.
    expect(after.baseline.sampleCount).toBe(10);
  });

  it('carries a measured latency regression through to the comparison', async () => {
    // The whole point of the gate: a real measurement taken inside the server
    // reaching the regression engine, and being reported as a change in a
    // measured value rather than as a conclusion about a cause.
    await runCli(['scan'], workspace);
    await installCollector();

    await write('sentinel-telemetry-01.json', {
      writtenAt: 1_772_366_400,
      latencies: [2, 2, 3, 2, 3, 2, 2, 3, 2, 3, 2, 2],
    });
    await runCli(['runtime', 'import'], workspace);
    await runCli(['baseline', 'create', 'before'], workspace);

    await write('sentinel-telemetry-02.json', {
      writtenAt: 1_772_370_000,
      latencies: [38, 41, 39, 42, 40, 43, 39, 41, 40, 42, 38, 41],
    });
    await runCli(['runtime', 'import'], workspace);
    await runCli(['baseline', 'create', 'after'], workspace);

    const result = await runCli(['compare', 'before', 'after', '--json'], workspace);
    const payload = parseJsonOutput<{
      performance: {
        compared: boolean;
        regressions: { resource: string; metric: string; verdict: string; explanation: string }[];
      };
    }>(result);

    expect(payload.performance.compared).toBe(true);
    expect(payload.performance.regressions).toHaveLength(1);

    const regression = payload.performance.regressions[0];
    expect(regression?.metric).toBe('scheduler_latency_ms');
    // Attributed to the server, because that is what was measured. Naming a
    // resource would be a claim about cause the measurement cannot support.
    expect(regression?.resource).toBe('(server)');
    expect(regression?.explanation).not.toMatch(/caused|because of/i);
  });

  it('does not compare measurements that do not exist, and says so', async () => {
    await runCli(['scan'], workspace);
    await runCli(['baseline', 'create', 'before'], workspace);
    await runCli(['baseline', 'create', 'after'], workspace);

    const result = await runCli(['compare', 'before', 'after'], workspace);
    expect(result.stdout).toContain('Performance:');
    expect(result.stdout).toContain('Not compared.');
  });

  it('reports measured runtime data in a scan report, separately from static analysis', async () => {
    await installCollector();
    await write('sentinel-telemetry-01.json', {
      writtenAt: 1_772_366_400,
      latencies: [2, 3],
      events: [{ kind: 'resource_state', resource: 'sf_core', detail: 'started' }],
    });

    const result = await runCli(['scan', '--format', 'json'], workspace);
    const report = JSON.parse(result.stdout) as {
      performance: {
        collected: boolean;
        sampleCount: number;
        runtime?: { collectorInstalled: boolean; metrics: string[]; limitation: string };
      };
    };

    expect(report.performance.collected).toBe(true);
    expect(report.performance.sampleCount).toBe(2);
    expect(report.performance.runtime?.collectorInstalled).toBe(true);
    expect(report.performance.runtime?.metrics).toEqual(['scheduler_latency_ms']);
    expect(report.performance.runtime?.limitation).toContain('no per-resource timing');
  });

  it('says nothing was measured, not that nothing was wrong, when no collector is installed', async () => {
    const result = await runCli(['scan', '--format', 'json'], workspace);
    const report = JSON.parse(result.stdout) as {
      performance: { collected: boolean; runtime?: unknown };
      limitations: string[];
    };

    expect(report.performance.collected).toBe(false);
    expect(report.performance.runtime).toBeUndefined();
    expect(report.limitations.some((limitation) => limitation.includes('collector is not installed'))).toBe(true);
  });

  it('never scores reliability from state transitions, and says why', async () => {
    await installCollector();
    await write('sentinel-telemetry-01.json', {
      writtenAt: 1_772_366_400,
      latencies: [],
      events: [
        { kind: 'resource_stopped', resource: 'sf_core', detail: 'stopped' },
        { kind: 'resource_started', resource: 'sf_core', detail: 'started' },
      ],
    });

    const result = await runCli(['scan', '--format', 'json'], workspace);
    const report = JSON.parse(result.stdout) as {
      health: { unavailable: Record<string, string> };
    };

    expect(report.health.unavailable['RELIABILITY']).toContain('no scripting API for runtime errors');
  });

  it('rejects an unknown subcommand instead of guessing', async () => {
    const result = await runCli(['runtime', 'collect'], workspace);
    expect(result.exitCode).toBe(EXIT_CODES.INVALID_INPUT);
    expect(result.stderr).toContain('Unknown runtime subcommand');
  });
});
