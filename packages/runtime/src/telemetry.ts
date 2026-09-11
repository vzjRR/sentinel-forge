/**
 * Telemetry ingestion.
 *
 * Reads the files written by the `sentinel_doctor` collector and turns them
 * into stored samples and events.
 *
 * Two properties are enforced here rather than assumed of the input:
 *
 *   - **The schema version is checked.** A file from a newer collector is
 *     refused with an explanation, not parsed hopefully.
 *   - **Nothing is invented.** A field the collector did not write stays
 *     absent. In particular the collector reports no per-resource timing —
 *     FiveM exposes no scripting API for it — and this module does not
 *     substitute anything for it.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { readTextFileBounded, type Logger } from '@sentinel-forge/core';
import type { PerformanceSampleInput } from '@sentinel-forge/performance';
import { COLLECTOR_RESOURCE, locateCollector, type CollectorInstallation } from './locate.js';

/** Schema versions this build understands. */
export const SUPPORTED_TELEMETRY_VERSIONS: readonly string[] = Object.freeze(['1.0']);

export interface TelemetrySample {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly playerCount?: number;
  /** Seconds since the epoch, as written by the collector. */
  readonly at: number;
}

export interface TelemetryEvent {
  readonly kind: string;
  readonly resource?: string;
  readonly detail?: string;
  readonly playerCount?: number;
  readonly at: number;
}

export interface TelemetryDocument {
  readonly schemaVersion: string;
  readonly collector: string;
  readonly collectorVersion?: string;
  readonly writtenAt: number;
  readonly serverUptimeMs: number;
  readonly samples: readonly TelemetrySample[];
  readonly events: readonly TelemetryEvent[];
  readonly dropped?: { readonly samples: number; readonly events: number };
  readonly limitations?: readonly string[];
}

export interface TelemetryReadProblem {
  /** Server-relative path of the file. */
  readonly file: string;
  readonly reason: string;
}

/** One telemetry document together with where it was read from. */
export interface LocatedTelemetryDocument {
  /** Server-relative path of the file the document was read from. */
  readonly file: string;
  readonly document: TelemetryDocument;
}

export interface TelemetryReadResult {
  readonly documents: readonly LocatedTelemetryDocument[];
  readonly problems: readonly TelemetryReadProblem[];
  /** Total samples and events the collector reported dropping. */
  readonly dropped: { readonly samples: number; readonly events: number };
  /** Where the collector was found, if anywhere. */
  readonly installations: readonly CollectorInstallation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates one telemetry document without trusting any field. */
export function parseTelemetry(raw: unknown): { document?: TelemetryDocument; problem?: string } {
  if (!isRecord(raw)) return { problem: 'Telemetry file is not a JSON object.' };

  const schemaVersion = raw['schemaVersion'];
  if (typeof schemaVersion !== 'string') return { problem: 'Telemetry file declares no schemaVersion.' };
  if (!SUPPORTED_TELEMETRY_VERSIONS.includes(schemaVersion)) {
    return {
      problem: `Telemetry schema ${schemaVersion} is not understood by this build (supported: ${SUPPORTED_TELEMETRY_VERSIONS.join(', ')}). Update Sentinel Forge.`,
    };
  }

  const samples: TelemetrySample[] = [];
  for (const entry of Array.isArray(raw['samples']) ? raw['samples'] : []) {
    if (!isRecord(entry)) continue;
    const value = entry['value'];
    const metric = entry['metric'];
    const unit = entry['unit'];
    const at = entry['at'];
    // A sample that is not a finite number is discarded rather than stored:
    // a NaN in a sample set poisons every statistic derived from it.
    if (typeof metric !== 'string' || typeof unit !== 'string') continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;

    samples.push({
      metric,
      value,
      unit,
      ...(typeof entry['playerCount'] === 'number' ? { playerCount: entry['playerCount'] } : {}),
      at,
    });
  }

  const events: TelemetryEvent[] = [];
  for (const entry of Array.isArray(raw['events']) ? raw['events'] : []) {
    if (!isRecord(entry)) continue;
    const kind = entry['kind'];
    const at = entry['at'];
    if (typeof kind !== 'string') continue;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;

    events.push({
      kind,
      ...(typeof entry['resource'] === 'string' ? { resource: entry['resource'] } : {}),
      ...(typeof entry['detail'] === 'string' ? { detail: entry['detail'] } : {}),
      ...(typeof entry['playerCount'] === 'number' ? { playerCount: entry['playerCount'] } : {}),
      at,
    });
  }

  const dropped = raw['dropped'];

  return {
    document: {
      schemaVersion,
      collector: typeof raw['collector'] === 'string' ? raw['collector'] : COLLECTOR_RESOURCE,
      ...(typeof raw['collectorVersion'] === 'string' ? { collectorVersion: raw['collectorVersion'] } : {}),
      writtenAt: typeof raw['writtenAt'] === 'number' ? raw['writtenAt'] : 0,
      serverUptimeMs: typeof raw['serverUptimeMs'] === 'number' ? raw['serverUptimeMs'] : 0,
      samples,
      events,
      ...(isRecord(dropped) && typeof dropped['samples'] === 'number' && typeof dropped['events'] === 'number'
        ? { dropped: { samples: dropped['samples'], events: dropped['events'] } }
        : {}),
      ...(Array.isArray(raw['limitations'])
        ? { limitations: raw['limitations'].filter((entry): entry is string => typeof entry === 'string') }
        : {}),
    },
  };
}

export interface ReadTelemetryOptions {
  /** Absolute path of the server root. */
  readonly serverRoot: string;
  /** Resource directories to search, relative to the server root. */
  readonly resourceDirectories: readonly string[];
  readonly maxFileBytes?: number;
  readonly logger?: Logger;
}

/**
 * Finds and reads every telemetry file written by the collector.
 *
 * An unreadable or unparseable file is reported as a problem and skipped: one
 * corrupt file must not discard the telemetry either side of it.
 */
export async function readTelemetry(options: ReadTelemetryOptions): Promise<TelemetryReadResult> {
  const documents: LocatedTelemetryDocument[] = [];
  const problems: TelemetryReadProblem[] = [];
  let droppedSamples = 0;
  let droppedEvents = 0;

  const installations = await locateCollector({
    serverRoot: options.serverRoot,
    resourceDirectories: options.resourceDirectories,
  });

  for (const installation of installations) {
    for (const file of installation.telemetryFiles) {
      try {
        const read = await readTextFileBounded(file.absolutePath, {
          root: options.serverRoot,
          ...(options.maxFileBytes === undefined ? {} : { maxBytes: options.maxFileBytes }),
        });

        const parsed = parseTelemetry(JSON.parse(read.content));
        if (parsed.document === undefined) {
          problems.push({ file: file.relativePath, reason: parsed.problem ?? 'Telemetry file could not be parsed.' });
          continue;
        }

        documents.push({ file: file.relativePath, document: parsed.document });
        droppedSamples += parsed.document.dropped?.samples ?? 0;
        droppedEvents += parsed.document.dropped?.events ?? 0;
      } catch (error) {
        problems.push({
          file: file.relativePath,
          reason: `Telemetry file could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      }
    }
  }

  options.logger?.debug('Telemetry read.', { documents: documents.length, problems: problems.length });

  return {
    documents,
    problems,
    dropped: { samples: droppedSamples, events: droppedEvents },
    installations,
  };
}

/** Provenance string recorded with every sample and event from a document. */
export function telemetrySource(document: TelemetryDocument): string {
  return `${document.collector}@${document.collectorVersion ?? 'unknown'}`;
}

/**
 * Converts telemetry samples into the storage shape, preserving provenance.
 *
 * Scheduler latency is attributed to `(server)` rather than to a resource.
 * It is measured from inside the collector's own thread and reflects how
 * promptly the server serviced it; naming a resource would be a claim about
 * cause that the measurement cannot support.
 */
export function toStoredSamples(
  serverId: string,
  documents: readonly LocatedTelemetryDocument[],
): PerformanceSampleInput[] {
  const stored: PerformanceSampleInput[] = [];

  for (const { document } of documents) {
    const source = telemetrySource(document);
    for (const sample of document.samples) {
      stored.push({
        serverId,
        resource: SERVER_SCOPE,
        metric: sample.metric,
        value: sample.value,
        unit: sample.unit,
        ...(sample.playerCount === undefined ? {} : { playerCount: sample.playerCount }),
        sampledAt: new Date(sample.at * 1000).toISOString(),
        source,
      });
    }
  }

  return stored;
}

/**
 * Resource name used for a measurement that belongs to the server as a whole.
 * Parenthesised so it cannot collide with a real resource name, which FiveM
 * restricts to characters valid in a directory name.
 */
export const SERVER_SCOPE = '(server)';

/** Summary of what the telemetry contains, for reporting. */
export interface TelemetrySummary {
  readonly documentCount: number;
  readonly sampleCount: number;
  readonly eventCount: number;
  readonly metrics: readonly string[];
  readonly resourcesObserved: readonly string[];
  readonly earliest?: string;
  readonly latest?: string;
  readonly dropped: { readonly samples: number; readonly events: number };
}

export function summarize(result: TelemetryReadResult): TelemetrySummary {
  const metrics = new Set<string>();
  const resources = new Set<string>();
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let sampleCount = 0;
  let eventCount = 0;

  for (const { document } of result.documents) {
    for (const sample of document.samples) {
      metrics.add(sample.metric);
      sampleCount += 1;
      earliest = Math.min(earliest, sample.at);
      latest = Math.max(latest, sample.at);
    }
    for (const event of document.events) {
      eventCount += 1;
      if (event.resource !== undefined) resources.add(event.resource);
      earliest = Math.min(earliest, event.at);
      latest = Math.max(latest, event.at);
    }
  }

  return {
    documentCount: result.documents.length,
    sampleCount,
    eventCount,
    metrics: [...metrics].sort(),
    resourcesObserved: [...resources].sort(),
    ...(Number.isFinite(earliest) ? { earliest: new Date(earliest * 1000).toISOString() } : {}),
    ...(Number.isFinite(latest) ? { latest: new Date(latest * 1000).toISOString() } : {}),
    dropped: result.dropped,
  };
}
