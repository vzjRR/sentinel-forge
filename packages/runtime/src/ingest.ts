/**
 * Telemetry ingestion.
 *
 * The collector writes into a fixed rotation of files, so the same document is
 * on disk — and read again — every time an import runs, until the rotation
 * overwrites it. Importing it twice would double every sample in it, and the
 * statistics the regression engine draws from those samples would be wrong in a
 * way nothing downstream could detect.
 *
 * So ingestion is idempotent: each document is identified by a digest over its
 * measurements, the digest is recorded when the document is imported, and a
 * document whose digest is already recorded is skipped. An operator can run
 * `sentinel runtime import` on a timer without corrupting their own history.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { fingerprint, type Clock, type DatabaseDriver } from '@sentinel-forge/core';
import { recordSamples } from '@sentinel-forge/performance';
import {
  telemetrySource,
  toStoredSamples,
  type LocatedTelemetryDocument,
  type TelemetryDocument,
  type TelemetryReadResult,
} from './telemetry.js';

export interface IngestOptions {
  readonly serverId: string;
  readonly clock: Clock;
}

export interface IngestedDocument {
  /** Server-relative path the document was read from. */
  readonly file: string;
  readonly digest: string;
  readonly sampleCount: number;
  readonly eventCount: number;
}

export interface IngestResult {
  /** Documents imported by this run. */
  readonly imported: readonly IngestedDocument[];
  /** Documents skipped because an identical document was already imported. */
  readonly alreadyImported: readonly IngestedDocument[];
  readonly samplesWritten: number;
  readonly eventsWritten: number;
  /**
   * Samples and events the collector itself reported dropping, across the
   * documents imported by this run. A gap is reported as a gap.
   */
  readonly droppedByCollector: { readonly samples: number; readonly events: number };
}

/**
 * Digest over what makes a document's content unique.
 *
 * The file name is deliberately excluded: the collector rotates through names,
 * so the same measurements can appear under a different name after a restart,
 * and importing them again because the name changed would be exactly the bug
 * this digest exists to prevent.
 */
export function digestDocument(document: TelemetryDocument): string {
  return fingerprint([
    `collector:${document.collector}`,
    `version:${document.collectorVersion ?? ''}`,
    `schema:${document.schemaVersion}`,
    `written:${String(document.writtenAt)}`,
    `uptime:${String(document.serverUptimeMs)}`,
    ...document.samples.map(
      (sample) =>
        `s:${sample.metric}:${String(sample.value)}:${sample.unit}:${String(sample.at)}:${String(sample.playerCount ?? '')}`,
    ),
    ...document.events.map(
      (event) => `e:${event.kind}:${event.resource ?? ''}:${event.detail ?? ''}:${String(event.at)}`,
    ),
  ]);
}

function describe(located: LocatedTelemetryDocument, digest: string): IngestedDocument {
  return {
    file: located.file,
    digest,
    sampleCount: located.document.samples.length,
    eventCount: located.document.events.length,
  };
}

/**
 * Writes telemetry into the local database.
 *
 * The whole import runs in one transaction: a failure part-way through leaves
 * no half-imported document behind, which would otherwise be recorded as
 * imported and never retried.
 */
export function ingestTelemetry(
  driver: DatabaseDriver,
  result: TelemetryReadResult,
  options: IngestOptions,
): IngestResult {
  const imported: IngestedDocument[] = [];
  const alreadyImported: IngestedDocument[] = [];
  let samplesWritten = 0;
  let eventsWritten = 0;
  let droppedSamples = 0;
  let droppedEvents = 0;

  const importedAt = options.clock.now().toISOString();

  const existing = driver.prepare('SELECT digest FROM runtime_ingest_files WHERE server_id = ?');
  const known = new Set(existing.all<{ digest: string }>(options.serverId).map((row) => row.digest));

  const fresh: { located: LocatedTelemetryDocument; digest: string }[] = [];
  // A document repeated within one read — the same measurements under two
  // rotation names — is imported once, so the digest set is updated as we go.
  for (const located of result.documents) {
    const digest = digestDocument(located.document);
    if (known.has(digest)) {
      alreadyImported.push(describe(located, digest));
      continue;
    }
    known.add(digest);
    fresh.push({ located, digest });
  }

  if (fresh.length === 0) {
    return {
      imported,
      alreadyImported,
      samplesWritten: 0,
      eventsWritten: 0,
      droppedByCollector: { samples: 0, events: 0 },
    };
  }

  driver.transaction(() => {
    const insertIngest = driver.prepare(
      `INSERT INTO runtime_ingest_files (server_id, path, digest, collector, collector_version, schema_version,
                                         sample_count, event_count, dropped_samples, dropped_events,
                                         written_at, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEvent = driver.prepare(
      `INSERT INTO runtime_events (server_id, ingest_id, kind, resource_name, detail, player_count, observed_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const { located, digest } of fresh) {
      const { document } = located;
      const source = telemetrySource(document);

      const ingestResult = insertIngest.run(
        options.serverId,
        located.file,
        digest,
        document.collector,
        document.collectorVersion ?? null,
        document.schemaVersion,
        document.samples.length,
        document.events.length,
        document.dropped?.samples ?? 0,
        document.dropped?.events ?? 0,
        // `writtenAt` is 0 when the collector wrote none; that is recorded as
        // "not stated" rather than as the Unix epoch.
        document.writtenAt > 0 ? new Date(document.writtenAt * 1000).toISOString() : null,
        importedAt,
      );

      const ingestId = ingestResult.lastInsertRowid;

      for (const event of document.events) {
        insertEvent.run(
          options.serverId,
          ingestId,
          event.kind,
          event.resource ?? null,
          event.detail ?? null,
          event.playerCount ?? null,
          new Date(event.at * 1000).toISOString(),
          source,
        );
        eventsWritten += 1;
      }

      samplesWritten += recordSamples(driver, toStoredSamples(options.serverId, [located]));

      droppedSamples += document.dropped?.samples ?? 0;
      droppedEvents += document.dropped?.events ?? 0;
      imported.push(describe(located, digest));
    }
  });

  return {
    imported,
    alreadyImported,
    samplesWritten,
    eventsWritten,
    droppedByCollector: { samples: droppedSamples, events: droppedEvents },
  };
}

/** What has been imported for a server, for `sentinel runtime status`. */
export interface StoredRuntimeState {
  readonly documentCount: number;
  readonly sampleCount: number;
  readonly eventCount: number;
  readonly droppedSamples: number;
  readonly droppedEvents: number;
  readonly firstImportedAt?: string;
  readonly lastImportedAt?: string;
  /** Most recent moment the collector wrote a file that has been imported. */
  readonly lastWrittenAt?: string;
  readonly collectorVersions: readonly string[];
}

interface StoredRuntimeRow {
  readonly documentCount: number;
  readonly sampleCount: number | null;
  readonly eventCount: number | null;
  readonly droppedSamples: number | null;
  readonly droppedEvents: number | null;
  readonly firstImportedAt: string | null;
  readonly lastImportedAt: string | null;
  readonly lastWrittenAt: string | null;
}

export function readStoredRuntimeState(driver: DatabaseDriver, serverId: string): StoredRuntimeState {
  const row = driver
    .prepare(
      `SELECT COUNT(*) AS documentCount,
              SUM(sample_count) AS sampleCount,
              SUM(event_count) AS eventCount,
              SUM(dropped_samples) AS droppedSamples,
              SUM(dropped_events) AS droppedEvents,
              MIN(imported_at) AS firstImportedAt,
              MAX(imported_at) AS lastImportedAt,
              MAX(written_at) AS lastWrittenAt
       FROM runtime_ingest_files WHERE server_id = ?`,
    )
    .get<StoredRuntimeRow>(serverId);

  const versions = driver
    .prepare(
      `SELECT DISTINCT collector_version AS version FROM runtime_ingest_files
       WHERE server_id = ? AND collector_version IS NOT NULL ORDER BY collector_version`,
    )
    .all<{ version: string }>(serverId);

  return {
    documentCount: row?.documentCount ?? 0,
    sampleCount: row?.sampleCount ?? 0,
    eventCount: row?.eventCount ?? 0,
    droppedSamples: row?.droppedSamples ?? 0,
    droppedEvents: row?.droppedEvents ?? 0,
    // SQL aggregates return NULL for an empty set; those become absent fields
    // rather than an invented timestamp.
    ...(row?.firstImportedAt === null || row?.firstImportedAt === undefined
      ? {}
      : { firstImportedAt: row.firstImportedAt }),
    ...(row?.lastImportedAt === null || row?.lastImportedAt === undefined ? {} : { lastImportedAt: row.lastImportedAt }),
    ...(row?.lastWrittenAt === null || row?.lastWrittenAt === undefined ? {} : { lastWrittenAt: row.lastWrittenAt }),
    collectorVersions: versions.map((entry) => entry.version),
  };
}

export interface StoredRuntimeEvent {
  readonly kind: string;
  readonly resource?: string;
  readonly detail?: string;
  readonly playerCount?: number;
  readonly observedAt: string;
  readonly source: string;
}

interface StoredRuntimeEventRow {
  readonly kind: string;
  readonly resource: string | null;
  readonly detail: string | null;
  readonly playerCount: number | null;
  readonly observedAt: string;
  readonly source: string;
}

/**
 * Reads observed events, newest first.
 *
 * Ordered by the row id as well as the timestamp: the collector records several
 * events in the same second, and ordering by time alone would not be stable
 * between two reads of the same data.
 */
export function loadRuntimeEvents(
  driver: DatabaseDriver,
  serverId: string,
  limit = 50,
): StoredRuntimeEvent[] {
  return driver
    .prepare(
      `SELECT kind, resource_name AS resource, detail, player_count AS playerCount,
              observed_at AS observedAt, source
       FROM runtime_events WHERE server_id = ?
       ORDER BY observed_at DESC, id DESC LIMIT ?`,
    )
    .all<StoredRuntimeEventRow>(serverId, limit)
    .map((row) => ({
      kind: row.kind,
      ...(row.resource === null ? {} : { resource: row.resource }),
      ...(row.detail === null ? {} : { detail: row.detail }),
      ...(row.playerCount === null ? {} : { playerCount: row.playerCount }),
      observedAt: row.observedAt,
      source: row.source,
    }));
}
