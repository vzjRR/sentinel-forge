import { describe, expect, it } from 'vitest';
import { correlate, formatDuration, type Signal } from './correlation.js';

const BASE = Date.parse('2026-01-01T20:00:00.000Z');

function at(offsetMinutes: number): string {
  return new Date(BASE + offsetMinutes * 60_000).toISOString();
}

function signal(kind: Signal['kind'], offsetMinutes: number, resource?: string): Signal {
  return {
    kind,
    occurredAt: at(offsetMinutes),
    ...(resource === undefined ? {} : { resource }),
    description: `${kind.toLowerCase()} on ${resource ?? 'server'}`,
  };
}

describe('change correlation', () => {
  it('links a change to an effect that follows it', () => {
    const links = correlate([
      signal('RESOURCE_CHANGED', 0, 'sf_inventory'),
      signal('PERFORMANCE_REGRESSION', 2, 'sf_inventory'),
    ]);

    expect(links).toHaveLength(1);
    expect(links[0]?.change.kind).toBe('RESOURCE_CHANGED');
    expect(links[0]?.effect.kind).toBe('PERFORMANCE_REGRESSION');
    expect(links[0]?.deltaMs).toBe(2 * 60_000);
  });

  it('rates a same-resource link above a cross-resource one', () => {
    const same = correlate([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 1, 'sf_a')])[0];
    const different = correlate([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 1, 'sf_b')])[0];
    expect(same?.confidence).toBeGreaterThan(different?.confidence ?? 1);
    expect(same?.reasons.some((reason) => reason.includes('Both observations concern'))).toBe(true);
  });

  it('rates a closer link above a more distant one', () => {
    const close = correlate([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 1, 'sf_a')])[0];
    const distant = correlate([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 25, 'sf_a')])[0];
    expect(close?.confidence).toBeGreaterThan(distant?.confidence ?? 1);
  });

  it('weakens a link where the effect precedes the change, and says so', () => {
    const links = correlate([signal('RESOURCE_CHANGED', 10, 'sf_a'), signal('PERFORMANCE_REGRESSION', 0, 'sf_a')]);
    expect(links[0]?.deltaMs).toBeLessThan(0);
    expect(links[0]?.reasons.some((reason) => reason.includes('before'))).toBe(true);
  });

  it('ignores observations outside the window', () => {
    expect(correlate([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 120, 'sf_a')])).toEqual([]);
  });

  it('never reaches certainty, because correlation is not causation', () => {
    const links = correlate([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('PERFORMANCE_REGRESSION', 0, 'sf_a')]);
    expect(links[0]?.confidence).toBeLessThanOrEqual(0.85);
  });

  it('does not pair two changes or two effects with each other', () => {
    expect(correlate([signal('RESOURCE_CHANGED', 0, 'sf_a'), signal('RESOURCE_CHANGED', 1, 'sf_b')])).toEqual([]);
    expect(correlate([signal('PERFORMANCE_REGRESSION', 0, 'sf_a'), signal('HEALTH_DROP', 1)])).toEqual([]);
  });

  it('treats a configuration change as a candidate for any effect in the window', () => {
    const links = correlate([signal('CONFIG_CHANGED', 0), signal('PERFORMANCE_REGRESSION', 3, 'sf_a')]);
    expect(links[0]?.reasons.some((reason) => reason.includes('whole server'))).toBe(true);
  });

  it('orders links by confidence, strongest first', () => {
    const links = correlate([
      signal('RESOURCE_CHANGED', 0, 'sf_a'),
      signal('PERFORMANCE_REGRESSION', 1, 'sf_a'),
      signal('PERFORMANCE_REGRESSION', 20, 'sf_b'),
    ]);
    expect(links[0]?.confidence).toBeGreaterThanOrEqual(links[1]?.confidence ?? 0);
  });

  it('ignores a signal with an unparseable timestamp instead of throwing', () => {
    const broken: Signal = { kind: 'RESOURCE_CHANGED', occurredAt: 'not a date', description: 'broken' };
    expect(() => correlate([broken, signal('PERFORMANCE_REGRESSION', 0, 'sf_a')])).not.toThrow();
  });

  it('formats durations for a timeline', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(5 * 60_000)).toBe('5m');
    expect(formatDuration(90 * 60_000)).toBe('1.5h');
  });
});
