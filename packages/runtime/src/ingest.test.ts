import { describe, expect, it } from 'vitest';
import { createFixedClock, openInMemoryDatabase, type OpenedDatabase } from '@sentinel-forge/core';
import { loadSamples } from '@sentinel-forge/performance';
import { digestDocument, ingestTelemetry, loadRuntimeEvents, readStoredRuntimeState } from './ingest.js';
import type { LocatedTelemetryDocument, TelemetryDocument, TelemetryReadResult } from './telemetry.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');

function withDatabase<T>(work: (database: OpenedDatabase) => T): T {
  const database = openInMemoryDatabase();
  try {
    database.driver
      .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .run('srv_1', '/opt/fxserver', 'fp', NOW.toISOString(), NOW.toISOString());
    return work(database);
  } finally {
    database.close();
  }
}

function makeDocument(overrides: Partial<TelemetryDocument> = {}): TelemetryDocument {
  return {
    schemaVersion: '1.0',
    collector: 'sentinel_doctor',
    collectorVersion: '0.6.0',
    writtenAt: 1_772_366_400,
    serverUptimeMs: 120_000,
    samples: [
      { metric: 'scheduler_latency_ms', value: 3, unit: 'ms', playerCount: 20, at: 1_772_366_340 },
      { metric: 'scheduler_latency_ms', value: 5, unit: 'ms', playerCount: 20, at: 1_772_366_341 },
    ],
    events: [{ kind: 'resource_started', resource: 'sf_shop', detail: 'started', playerCount: 20, at: 1_772_366_350 }],
    dropped: { samples: 0, events: 0 },
    ...overrides,
  };
}

function result(...documents: LocatedTelemetryDocument[]): TelemetryReadResult {
  return {
    documents,
    problems: [],
    dropped: { samples: 0, events: 0 },
    installations: [
      {
        absolutePath: '/opt/fxserver/resources/sentinel_doctor',
        relativePath: 'resources/sentinel_doctor',
        telemetryFiles: [],
        hasTelemetryDirectory: true,
      },
    ],
  };
}

const clock = createFixedClock(NOW);

describe('ingestTelemetry', () => {
  it('records samples and events with provenance', () => {
    withDatabase((database) => {
      const ingested = ingestTelemetry(
        database.driver,
        result({ file: 'resources/sentinel_doctor/telemetry/a.json', document: makeDocument() }),
        { serverId: 'srv_1', clock },
      );

      expect(ingested.imported).toHaveLength(1);
      expect(ingested.samplesWritten).toBe(2);
      expect(ingested.eventsWritten).toBe(1);

      const samples = loadSamples(database.driver, { serverId: 'srv_1' });
      expect(samples).toHaveLength(2);
      expect(samples[0]).toMatchObject({ resource: '(server)', metric: 'scheduler_latency_ms', value: 3 });

      const events = loadRuntimeEvents(database.driver, 'srv_1');
      expect(events[0]).toMatchObject({
        kind: 'resource_started',
        resource: 'sf_shop',
        detail: 'started',
        playerCount: 20,
        source: 'sentinel_doctor@0.6.0',
      });
    });
  });

  it('does not import the same document twice', () => {
    // The collector writes into a fixed rotation of file names, so the same
    // document is on disk across several imports. Counting it twice would
    // double every sample in it and corrupt the statistics silently.
    withDatabase((database) => {
      const read = result({ file: 'resources/sentinel_doctor/telemetry/a.json', document: makeDocument() });

      const first = ingestTelemetry(database.driver, read, { serverId: 'srv_1', clock });
      const second = ingestTelemetry(database.driver, read, { serverId: 'srv_1', clock });

      expect(first.imported).toHaveLength(1);
      expect(second.imported).toHaveLength(0);
      expect(second.alreadyImported).toHaveLength(1);
      expect(second.samplesWritten).toBe(0);
      expect(loadSamples(database.driver, { serverId: 'srv_1' })).toHaveLength(2);
    });
  });

  it('skips a document already imported under a different file name', () => {
    // Rotation means the same measurements can reappear under another name
    // after a restart. Identity is the content, not the file it sits in.
    withDatabase((database) => {
      const document = makeDocument();
      ingestTelemetry(database.driver, result({ file: 'telemetry/sentinel-telemetry-01.json', document }), {
        serverId: 'srv_1',
        clock,
      });

      const second = ingestTelemetry(
        database.driver,
        result({ file: 'telemetry/sentinel-telemetry-07.json', document }),
        { serverId: 'srv_1', clock },
      );

      expect(second.imported).toHaveLength(0);
      expect(loadSamples(database.driver, { serverId: 'srv_1' })).toHaveLength(2);
    });
  });

  it('imports a duplicate appearing twice within one read exactly once', () => {
    withDatabase((database) => {
      const document = makeDocument();
      const ingested = ingestTelemetry(
        database.driver,
        result({ file: 'a.json', document }, { file: 'b.json', document }),
        { serverId: 'srv_1', clock },
      );

      expect(ingested.imported).toHaveLength(1);
      expect(ingested.alreadyImported).toHaveLength(1);
      expect(loadSamples(database.driver, { serverId: 'srv_1' })).toHaveLength(2);
    });
  });

  it('imports a later document from the same collector', () => {
    withDatabase((database) => {
      ingestTelemetry(database.driver, result({ file: 'a.json', document: makeDocument() }), {
        serverId: 'srv_1',
        clock,
      });

      const later = ingestTelemetry(
        database.driver,
        result({
          file: 'b.json',
          document: makeDocument({
            writtenAt: 1_772_366_500,
            samples: [{ metric: 'scheduler_latency_ms', value: 11, unit: 'ms', at: 1_772_366_460 }],
            events: [],
          }),
        }),
        { serverId: 'srv_1', clock },
      );

      expect(later.imported).toHaveLength(1);
      expect(later.samplesWritten).toBe(1);
      expect(loadSamples(database.driver, { serverId: 'srv_1' })).toHaveLength(3);
    });
  });

  it('carries what the collector dropped through rather than hiding the gap', () => {
    withDatabase((database) => {
      const ingested = ingestTelemetry(
        database.driver,
        result({ file: 'a.json', document: makeDocument({ dropped: { samples: 41, events: 2 } }) }),
        { serverId: 'srv_1', clock },
      );

      expect(ingested.droppedByCollector).toEqual({ samples: 41, events: 2 });
      expect(readStoredRuntimeState(database.driver, 'srv_1')).toMatchObject({
        droppedSamples: 41,
        droppedEvents: 2,
      });
    });
  });

  it('records no write time rather than the Unix epoch when the collector stated none', () => {
    withDatabase((database) => {
      ingestTelemetry(database.driver, result({ file: 'a.json', document: makeDocument({ writtenAt: 0 }) }), {
        serverId: 'srv_1',
        clock,
      });

      expect(readStoredRuntimeState(database.driver, 'srv_1').lastWrittenAt).toBeUndefined();
    });
  });

  it('writes nothing at all when there is nothing new', () => {
    withDatabase((database) => {
      const ingested = ingestTelemetry(database.driver, result(), { serverId: 'srv_1', clock });
      expect(ingested).toMatchObject({ samplesWritten: 0, eventsWritten: 0 });
      expect(readStoredRuntimeState(database.driver, 'srv_1').documentCount).toBe(0);
    });
  });
});

describe('digestDocument', () => {
  it('ignores the file a document was found in', () => {
    expect(digestDocument(makeDocument())).toBe(digestDocument(makeDocument()));
  });

  it('changes when a measurement changes', () => {
    const changed = makeDocument({ samples: [{ metric: 'scheduler_latency_ms', value: 4, unit: 'ms', at: 1 }] });
    expect(digestDocument(changed)).not.toBe(digestDocument(makeDocument()));
  });

  it('changes when only the write time differs', () => {
    // Two flushes can legitimately carry identical measurements; the write time
    // is what makes them two observations rather than one repeated.
    expect(digestDocument(makeDocument({ writtenAt: 1_772_366_999 }))).not.toBe(digestDocument(makeDocument()));
  });
});

describe('readStoredRuntimeState', () => {
  it('reports nothing imported for a server with no telemetry', () => {
    withDatabase((database) => {
      expect(readStoredRuntimeState(database.driver, 'srv_1')).toEqual({
        documentCount: 0,
        sampleCount: 0,
        eventCount: 0,
        droppedSamples: 0,
        droppedEvents: 0,
        collectorVersions: [],
      });
    });
  });

  it('reports the collector versions seen, so a mixed fleet is visible', () => {
    withDatabase((database) => {
      ingestTelemetry(database.driver, result({ file: 'a.json', document: makeDocument() }), {
        serverId: 'srv_1',
        clock,
      });
      ingestTelemetry(
        database.driver,
        result({ file: 'b.json', document: makeDocument({ collectorVersion: '0.7.0', writtenAt: 1_772_370_000 }) }),
        { serverId: 'srv_1', clock },
      );

      expect(readStoredRuntimeState(database.driver, 'srv_1').collectorVersions).toEqual(['0.6.0', '0.7.0']);
    });
  });
});
