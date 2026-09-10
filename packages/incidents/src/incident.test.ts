import { describe, expect, it } from 'vitest';
import { createFixedClock, openInMemoryDatabase, type OpenedDatabase } from '@sentinel-forge/core';
import { buildIncidents, listIncidents, persistIncidents } from './incident.js';
import type { Signal } from './correlation.js';

const clock = createFixedClock(new Date('2026-01-01T20:00:00.000Z'));
const BASE = Date.parse('2026-01-01T20:00:00.000Z');

function signal(kind: Signal['kind'], offsetMinutes: number, resource?: string): Signal {
  return {
    kind,
    occurredAt: new Date(BASE + offsetMinutes * 60_000).toISOString(),
    ...(resource === undefined ? {} : { resource }),
    description: `${kind.toLowerCase().replace(/_/g, ' ')} on ${resource ?? 'server'}`,
  };
}

function build(signals: Signal[]): ReturnType<typeof buildIncidents> {
  return buildIncidents({ serverId: 'srv_1', signals, clock });
}

describe('incident engine', () => {
  it('builds an incident from a change followed by an effect', () => {
    const incidents = build([
      signal('RESOURCE_CHANGED', 0, 'sf_inventory'),
      signal('PERFORMANCE_REGRESSION', 2, 'sf_inventory'),
    ]);

    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.affectedResources).toEqual(['sf_inventory']);
    expect(incidents[0]?.events).toHaveLength(2);
    expect(incidents[0]?.confidence).toBeGreaterThan(0);
  });

  it('does not create an incident from changes alone', () => {
    // A resource being updated is not a problem until something follows it.
    expect(build([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('RESOURCE_CHANGED', 1, 'sf_b')])).toEqual([]);
  });

  it('states that correlation is not causation in the summary', () => {
    const incidents = build([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 1, 'sf_a')]);
    expect(incidents[0]?.summary).toContain('does not establish causation');
    expect(incidents[0]?.summary).not.toMatch(/caused by|is responsible for/i);
  });

  it('recommends inspection rather than asserting a cause', () => {
    const incidents = build([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 1, 'sf_a')]);
    expect(incidents[0]?.recommendation).toContain('confirm whether');
  });

  it('splits signals separated by more than the window into separate incidents', () => {
    const incidents = build([
      signal('RESOURCE_CHANGED', 0, 'sf_a'),
      signal('PERFORMANCE_REGRESSION', 1, 'sf_a'),
      signal('RESOURCE_CHANGED', 300, 'sf_b'),
      signal('PERFORMANCE_REGRESSION', 301, 'sf_b'),
    ]);
    expect(incidents).toHaveLength(2);
  });

  it('builds a timeline in chronological order', () => {
    const incidents = build([
      signal('PERFORMANCE_REGRESSION', 3, 'sf_a'),
      signal('RESOURCE_CHANGED', 0, 'sf_a'),
      signal('HEALTH_DROP', 5),
    ]);
    const times = incidents[0]?.events.map((event) => event.occurredAt) ?? [];
    expect([...times]).toEqual([...times].sort());
  });

  it('raises severity for a confident regression', () => {
    const strong = build([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 0, 'sf_a')]);
    const weak = build([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('FINDING_INTRODUCED', 20, 'sf_b')]);
    expect(strong[0]?.severity).toBe('HIGH');
    expect(weak[0]?.severity).toBe('LOW');
  });

  it('returns nothing for no signals', () => {
    expect(build([])).toEqual([]);
  });

  it('persists incidents and reads them back with their timelines', () => {
    const database: OpenedDatabase = openInMemoryDatabase();
    try {
      database.driver
        .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
        .run('srv_1', '/opt/fxserver', 'fp', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

      const incidents = build([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 2, 'sf_a')]);
      expect(persistIncidents(database.driver, incidents)).toBe(1);

      const stored = listIncidents(database.driver, 'srv_1');
      expect(stored).toHaveLength(1);
      expect(stored[0]?.affectedResources).toEqual(['sf_a']);
      expect(stored[0]?.events).toHaveLength(2);
      expect(stored[0]?.confidence).toBeCloseTo(incidents[0]?.confidence ?? 0, 5);
    } finally {
      database.close();
    }
  });

  it('does not store a link to a finding that is not in the database', () => {
    // A finding referenced by an incident may belong to a purged scan; the
    // foreign key would otherwise reject the whole insert.
    const database = openInMemoryDatabase();
    try {
      database.driver
        .prepare('INSERT INTO servers (id, path, fingerprint, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
        .run('srv_1', '/opt/fxserver', 'fp', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

      const incidents = build([
        signal('RESOURCE_CHANGED', 0, 'sf_a'),
        { ...signal('FINDING_INTRODUCED', 1, 'sf_a'), findingId: 'fnd_missing' },
      ]);
      expect(() => persistIncidents(database.driver, incidents)).not.toThrow();

      const stored = listIncidents(database.driver, 'srv_1');
      expect(stored[0]?.events.some((event) => event.findingId !== undefined)).toBe(false);
    } finally {
      database.close();
    }
  });
});
