import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTelemetry, readTelemetry, summarize, toStoredSamples, SERVER_SCOPE } from './telemetry.js';

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    collector: 'sentinel_doctor',
    collectorVersion: '0.6.0',
    writtenAt: 1_767_225_600,
    serverUptimeMs: 90_000,
    samples: [{ metric: 'scheduler_latency_ms', value: 4, unit: 'ms', playerCount: 12, at: 1_767_225_590 }],
    events: [{ kind: 'resource_started', resource: 'sf_shop', detail: 'started', playerCount: 12, at: 1_767_225_595 }],
    dropped: { samples: 0, events: 0 },
    ...overrides,
  };
}

describe('parseTelemetry', () => {
  it('reads a well-formed document', () => {
    const parsed = parseTelemetry(document());
    expect(parsed.problem).toBeUndefined();
    expect(parsed.document?.samples).toHaveLength(1);
    expect(parsed.document?.events[0]).toMatchObject({ kind: 'resource_started', resource: 'sf_shop' });
  });

  it('refuses a schema version it does not understand rather than guessing', () => {
    const parsed = parseTelemetry(document({ schemaVersion: '9.9' }));
    expect(parsed.document).toBeUndefined();
    expect(parsed.problem).toContain('9.9');
    expect(parsed.problem).toContain('Update Sentinel Forge');
  });

  it('refuses a document that declares no schema version', () => {
    expect(parseTelemetry({ samples: [] }).problem).toContain('no schemaVersion');
    expect(parseTelemetry('not an object').problem).toContain('not a JSON object');
  });

  it('discards a sample whose value is not a finite number', () => {
    // A NaN or an Infinity in a sample set poisons every statistic drawn from
    // it, and nothing downstream could tell that it had.
    const parsed = parseTelemetry(
      document({
        samples: [
          { metric: 'scheduler_latency_ms', value: 'fast', unit: 'ms', at: 1 },
          { metric: 'scheduler_latency_ms', value: null, unit: 'ms', at: 2 },
          { metric: 'scheduler_latency_ms', value: 7, unit: 'ms', at: 3 },
        ],
      }),
    );
    expect(parsed.document?.samples).toEqual([{ metric: 'scheduler_latency_ms', value: 7, unit: 'ms', at: 3 }]);
  });

  it('discards an event with no kind or no timestamp', () => {
    const parsed = parseTelemetry(
      document({ events: [{ resource: 'sf_shop', at: 1 }, { kind: 'resource_stopped' }, { kind: 'ok', at: 5 }] }),
    );
    expect(parsed.document?.events).toEqual([{ kind: 'ok', at: 5 }]);
  });

  it('keeps a missing optional field absent rather than substituting a value', () => {
    const parsed = parseTelemetry(
      document({ samples: [{ metric: 'scheduler_latency_ms', value: 1, unit: 'ms', at: 9 }], collectorVersion: 7 }),
    );
    expect(parsed.document?.samples[0]).not.toHaveProperty('playerCount');
    expect(parsed.document).not.toHaveProperty('collectorVersion');
  });

  it('carries the collector\'s own statement of its limitations through', () => {
    const parsed = parseTelemetry(document({ limitations: ['no per-resource timing', 42] }));
    expect(parsed.document?.limitations).toEqual(['no per-resource timing']);
  });
});

describe('toStoredSamples', () => {
  it('attributes scheduler latency to the server, not to a resource', () => {
    const parsed = parseTelemetry(document());
    const stored = toStoredSamples('srv_1', [{ file: 'resources/sentinel_doctor/telemetry/a.json', document: parsed.document! }]);

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      serverId: 'srv_1',
      resource: SERVER_SCOPE,
      metric: 'scheduler_latency_ms',
      value: 4,
      unit: 'ms',
      playerCount: 12,
      source: 'sentinel_doctor@0.6.0',
    });
    expect(stored[0]?.sampledAt).toBe(new Date(1_767_225_590 * 1000).toISOString());
  });

  it('records provenance as unknown rather than inventing a collector version', () => {
    const parsed = parseTelemetry(document({ collectorVersion: undefined }));
    const stored = toStoredSamples('srv_1', [{ file: 'a.json', document: parsed.document! }]);
    expect(stored[0]?.source).toBe('sentinel_doctor@unknown');
  });
});

describe('readTelemetry', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sentinel-runtime-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeTelemetry(relative: string, contents: unknown): Promise<void> {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
  }

  it('reports the collector as absent when it is not installed', async () => {
    await writeTelemetry('resources/sf_shop/fxmanifest.lua', "fx_version 'cerulean'");
    const result = await readTelemetry({ serverRoot: root, resourceDirectories: ['resources'] });

    expect(result.installations).toEqual([]);
    expect(result.documents).toEqual([]);
  });

  it('finds the collector directly under a resource directory', async () => {
    await writeTelemetry('resources/sentinel_doctor/telemetry/sentinel-telemetry-01.json', document());
    const result = await readTelemetry({ serverRoot: root, resourceDirectories: ['resources'] });

    expect(result.installations).toHaveLength(1);
    expect(result.installations[0]?.relativePath).toBe('resources/sentinel_doctor');
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.file).toBe('resources/sentinel_doctor/telemetry/sentinel-telemetry-01.json');
  });

  it('finds the collector inside a category directory', async () => {
    await writeTelemetry('resources/[local]/sentinel_doctor/telemetry/sentinel-telemetry-01.json', document());
    const result = await readTelemetry({ serverRoot: root, resourceDirectories: ['resources'] });

    expect(result.installations[0]?.relativePath).toBe('resources/[local]/sentinel_doctor');
    expect(result.documents).toHaveLength(1);
  });

  it('reports an installation that has written nothing as installed but silent', async () => {
    await mkdir(path.join(root, 'resources', 'sentinel_doctor'), { recursive: true });
    const result = await readTelemetry({ serverRoot: root, resourceDirectories: ['resources'] });

    expect(result.installations[0]).toMatchObject({ hasTelemetryDirectory: false, telemetryFiles: [] });
    expect(result.documents).toEqual([]);
  });

  it('keeps the readable files when one file is corrupt', async () => {
    await writeTelemetry('resources/sentinel_doctor/telemetry/sentinel-telemetry-01.json', document());
    await writeTelemetry('resources/sentinel_doctor/telemetry/sentinel-telemetry-02.json', '{ not json');
    await writeTelemetry('resources/sentinel_doctor/telemetry/sentinel-telemetry-03.json', document({ writtenAt: 2 }));

    const result = await readTelemetry({ serverRoot: root, resourceDirectories: ['resources'] });

    expect(result.documents).toHaveLength(2);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.file).toContain('sentinel-telemetry-02.json');
  });

  it('totals what the collector reported dropping', async () => {
    await writeTelemetry('resources/sentinel_doctor/telemetry/a.json', document({ dropped: { samples: 3, events: 1 } }));
    await writeTelemetry('resources/sentinel_doctor/telemetry/b.json', document({ dropped: { samples: 4, events: 0 } }));

    const result = await readTelemetry({ serverRoot: root, resourceDirectories: ['resources'] });
    expect(result.dropped).toEqual({ samples: 7, events: 1 });
  });

  it('ignores files that are not telemetry', async () => {
    await writeTelemetry('resources/sentinel_doctor/telemetry/README.md', 'not telemetry');
    await writeTelemetry('resources/sentinel_doctor/telemetry/a.json', document());

    const result = await readTelemetry({ serverRoot: root, resourceDirectories: ['resources'] });
    expect(result.documents).toHaveLength(1);
    expect(result.problems).toEqual([]);
  });
});

describe('summarize', () => {
  it('reports the window the telemetry covers and what it contains', () => {
    const first = parseTelemetry(document()).document!;
    const second = parseTelemetry(
      document({
        samples: [{ metric: 'scheduler_latency_ms', value: 9, unit: 'ms', at: 1_767_229_000 }],
        events: [{ kind: 'resource_stopped', resource: 'sf_bank', at: 1_767_229_100 }],
      }),
    ).document!;

    const summary = summarize({
      documents: [
        { file: 'a.json', document: first },
        { file: 'b.json', document: second },
      ],
      problems: [],
      dropped: { samples: 0, events: 0 },
      installations: [],
    });

    expect(summary).toMatchObject({
      documentCount: 2,
      sampleCount: 2,
      eventCount: 2,
      metrics: ['scheduler_latency_ms'],
      resourcesObserved: ['sf_bank', 'sf_shop'],
    });
    expect(summary.earliest).toBe(new Date(1_767_225_590 * 1000).toISOString());
    expect(summary.latest).toBe(new Date(1_767_229_100 * 1000).toISOString());
  });

  it('reports no window rather than an epoch date when nothing was measured', () => {
    const summary = summarize({
      documents: [],
      problems: [],
      dropped: { samples: 0, events: 0 },
      installations: [],
    });
    expect(summary.earliest).toBeUndefined();
    expect(summary.latest).toBeUndefined();
    expect(summary.sampleCount).toBe(0);
  });
});
