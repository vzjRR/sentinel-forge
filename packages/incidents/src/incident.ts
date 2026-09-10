/**
 * Incident engine.
 *
 * An incident groups signals that occurred close together and appear related,
 * and presents them as a timeline with the evidence for the relationship and a
 * confidence value.
 *
 * What an incident deliberately does not do is name a cause. The output is
 * "these resources are likely related to what you are seeing, here is why, here
 * is how sure we are" — which is what a human can act on without being misled.
 */

import { incidentId as newIncidentId, type Clock, type DatabaseDriver } from '@sentinel-forge/core';
import type { Severity } from '@sentinel-forge/shared';
import { correlate, formatDuration, type CorrelationLink, type Signal } from './correlation.js';

export interface IncidentEvent {
  readonly occurredAt: string;
  readonly type: string;
  readonly resource?: string;
  readonly description: string;
  readonly findingId?: string;
}

export interface Incident {
  readonly id: string;
  readonly serverId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly severity: Severity;
  /** 0–1 that the grouped signals belong to the same story. */
  readonly confidence: number;
  readonly summary: string;
  readonly affectedResources: readonly string[];
  readonly events: readonly IncidentEvent[];
  /** The relationships that justified grouping these signals. */
  readonly links: readonly CorrelationLink[];
  /** What a human should look at next. */
  readonly recommendation: string;
}

export interface BuildIncidentsInput {
  readonly serverId: string;
  readonly signals: readonly Signal[];
  readonly clock: Clock;
  /** Signals further apart than this start a new incident. Default 30 minutes. */
  readonly windowMs?: number;
}

/**
 * Groups signals into incidents.
 *
 * Grouping is by time: signals within one window of each other belong to the
 * same incident. An incident with no effect-like signal is not an incident —
 * a resource being updated is not a problem until something else follows it.
 */
export function buildIncidents(input: BuildIncidentsInput): Incident[] {
  const windowMs = input.windowMs ?? 30 * 60 * 1000;
  const ordered = [...input.signals]
    .filter((signal) => !Number.isNaN(Date.parse(signal.occurredAt)))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  if (ordered.length === 0) return [];

  const groups: Signal[][] = [];
  let current: Signal[] = [];
  let previousTime = 0;

  for (const signal of ordered) {
    const time = Date.parse(signal.occurredAt);
    if (current.length === 0 || time - previousTime <= windowMs) {
      current.push(signal);
    } else {
      groups.push(current);
      current = [signal];
    }
    previousTime = time;
  }
  if (current.length > 0) groups.push(current);

  const incidents: Incident[] = [];

  for (const group of groups) {
    const links = correlate(group, { windowMs });
    if (links.length === 0) continue;

    const strongest = links[0];
    if (strongest === undefined) continue;

    const resources = [...new Set(group.map((signal) => signal.resource).filter((name): name is string => name !== undefined))].sort();
    const startedAt = group[0]?.occurredAt ?? input.clock.now().toISOString();
    const endedAt = group[group.length - 1]?.occurredAt;

    incidents.push({
      id: newIncidentId(),
      serverId: input.serverId,
      startedAt,
      ...(endedAt === undefined || endedAt === startedAt ? {} : { endedAt }),
      severity: severityFor(group, strongest.confidence),
      confidence: strongest.confidence,
      summary: summarize(group, strongest),
      affectedResources: resources,
      events: group.map((signal) => ({
        occurredAt: signal.occurredAt,
        type: signal.kind,
        ...(signal.resource === undefined ? {} : { resource: signal.resource }),
        description: signal.description,
        ...(signal.findingId === undefined ? {} : { findingId: signal.findingId }),
      })),
      links,
      recommendation: recommend(strongest),
    });
  }

  return incidents;
}

function severityFor(group: readonly Signal[], confidence: number): Severity {
  const hasRegression = group.some((signal) => signal.kind === 'PERFORMANCE_REGRESSION');
  const hasHealthDrop = group.some((signal) => signal.kind === 'HEALTH_DROP');

  if (hasRegression && confidence >= 0.6) return 'HIGH';
  if (hasRegression || hasHealthDrop) return 'MEDIUM';
  return 'LOW';
}

function summarize(group: readonly Signal[], strongest: CorrelationLink): string {
  const effects = group.filter((signal) => signal.kind.startsWith('PERFORMANCE') || signal.kind === 'HEALTH_DROP' || signal.kind === 'FINDING_INTRODUCED');
  const changes = group.filter((signal) => signal.kind.startsWith('RESOURCE') || signal.kind === 'CONFIG_CHANGED');

  const relation =
    strongest.deltaMs >= 0
      ? `${strongest.effect.description} was observed ${formatDuration(strongest.deltaMs)} after ${strongest.change.description.toLowerCase()}`
      : `${strongest.effect.description} was observed before ${strongest.change.description.toLowerCase()}`;

  return [
    `${String(changes.length)} change(s) and ${String(effects.length)} effect(s) were observed in the same window.`,
    `${relation}.`,
    'Temporal correlation does not establish causation; these observations are related in time and require verification.',
  ].join(' ');
}

function recommend(strongest: CorrelationLink): string {
  const resource = strongest.change.resource ?? strongest.effect.resource;
  return resource === undefined
    ? 'Review what changed on the server in this window, then confirm whether it accounts for the observed effect.'
    : `Inspect what changed in ${resource} during this window, then confirm whether it accounts for the observed effect.`;
}

/** Persists incidents and their timelines in one transaction. */
export function persistIncidents(driver: DatabaseDriver, incidents: readonly Incident[]): number {
  if (incidents.length === 0) return 0;

  return driver.transaction(() => {
    const incidentStatement = driver.prepare(
      `INSERT INTO incidents (id, server_id, started_at, ended_at, severity, confidence, summary, affected_resources_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const eventStatement = driver.prepare(
      `INSERT INTO incident_events (incident_id, occurred_at, event_type, resource_name, description, finding_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    let written = 0;
    for (const incident of incidents) {
      incidentStatement.run(
        incident.id,
        incident.serverId,
        incident.startedAt,
        incident.endedAt ?? null,
        incident.severity,
        incident.confidence,
        incident.summary,
        JSON.stringify(incident.affectedResources),
        new Date().toISOString(),
      );

      for (const event of incident.events) {
        eventStatement.run(
          incident.id,
          event.occurredAt,
          event.type,
          event.resource ?? null,
          event.description,
          // A finding referenced by an incident may belong to a scan that has
          // since been purged, so the link is stored only when it still exists.
          findingExists(driver, event.findingId) ? (event.findingId ?? null) : null,
          null,
        );
      }
      written += 1;
    }
    return written;
  });
}

function findingExists(driver: DatabaseDriver, findingId: string | undefined): boolean {
  if (findingId === undefined) return false;
  return driver.prepare('SELECT 1 AS present FROM findings WHERE id = ?').get<{ present: number }>(findingId) !== undefined;
}

export interface StoredIncident {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly severity: string;
  readonly confidence: number;
  readonly summary: string;
  readonly affectedResources: readonly string[];
  readonly events: readonly IncidentEvent[];
}

export function listIncidents(driver: DatabaseDriver, serverId: string, limit = 20): StoredIncident[] {
  const rows = driver
    .prepare(
      `SELECT id, started_at AS startedAt, ended_at AS endedAt, severity, confidence, summary,
              affected_resources_json AS affectedResourcesJson
       FROM incidents WHERE server_id = ? ORDER BY started_at DESC LIMIT ?`,
    )
    .all<{
      id: string;
      startedAt: string;
      endedAt: string | null;
      severity: string;
      confidence: number;
      summary: string;
      affectedResourcesJson: string;
    }>(serverId, limit);

  return rows.map((row) => ({
    id: row.id,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    severity: row.severity,
    confidence: row.confidence,
    summary: row.summary,
    affectedResources: JSON.parse(row.affectedResourcesJson) as string[],
    events: driver
      .prepare(
        `SELECT occurred_at AS occurredAt, event_type AS type, resource_name AS resource, description,
                finding_id AS findingId
         FROM incident_events WHERE incident_id = ? ORDER BY occurred_at`,
      )
      .all<{ occurredAt: string; type: string; resource: string | null; description: string; findingId: string | null }>(row.id)
      .map((event) => ({
        occurredAt: event.occurredAt,
        type: event.type,
        ...(event.resource === null ? {} : { resource: event.resource }),
        description: event.description,
        ...(event.findingId === null ? {} : { findingId: event.findingId }),
      })),
  }));
}
