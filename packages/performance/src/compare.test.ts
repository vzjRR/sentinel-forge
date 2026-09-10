import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@sentinel-forge/core';
import { compareBaselines } from './compare.js';
import type { BaselineFindingEntry, BaselineRecord, BaselineResourceEntry } from './baseline.js';

const clock = createFixedClock(new Date('2026-01-01T00:00:00.000Z'));

function baseline(label: string, overrides: Partial<BaselineRecord> = {}): BaselineRecord {
  return {
    id: `bl_${label}`,
    serverId: 'srv_1',
    label,
    serverFingerprint: 'fp',
    configFingerprint: 'cfg',
    resourceCount: 2,
    findingCount: 0,
    sampleCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function resource(name: string, hash: string, overrides: Partial<BaselineResourceEntry> = {}): BaselineResourceEntry {
  return { resource: name, path: `resources/${name}`, fileCount: 3, totalBytes: 300, contentHash: hash, ...overrides };
}

function finding(id: string, resourceName = 'sf_core'): BaselineFindingEntry {
  return {
    findingId: id,
    ruleId: 'PERF-LOOP-001',
    severity: 'HIGH',
    confidence: 0.9,
    resource: resourceName,
    title: 'Loop without an observable yield',
  };
}

function compare(input: Partial<Parameters<typeof compareBaselines>[0]> = {}): ReturnType<typeof compareBaselines> {
  return compareBaselines({
    before: baseline('before'),
    after: baseline('after', { createdAt: '2026-01-02T00:00:00.000Z' }),
    beforeResources: [resource('sf_core', 'h1'), resource('sf_shop', 'h2')],
    afterResources: [resource('sf_core', 'h1'), resource('sf_shop', 'h2')],
    beforeFindings: [],
    afterFindings: [],
    clock,
    ...input,
  });
}

describe('baseline comparison', () => {
  it('reports nothing changed for identical baselines', () => {
    const result = compare();
    expect(result.resourceChanges.every((change) => change.kind === 'UNCHANGED')).toBe(true);
    expect(result.findingChanges).toEqual([]);
    expect(result.configurationChanged).toBe(false);
  });

  it('detects an added and a removed resource', () => {
    const result = compare({
      beforeResources: [resource('sf_core', 'h1'), resource('sf_old', 'h3')],
      afterResources: [resource('sf_core', 'h1'), resource('sf_new', 'h4')],
    });
    const byKind = new Map(result.resourceChanges.map((change) => [change.resource, change.kind]));
    expect(byKind.get('sf_new')).toBe('ADDED');
    expect(byKind.get('sf_old')).toBe('REMOVED');
    expect(byKind.get('sf_core')).toBe('UNCHANGED');
  });

  it('detects modified content and says what differed', () => {
    const result = compare({
      afterResources: [resource('sf_core', 'changed', { fileCount: 4, totalBytes: 400 }), resource('sf_shop', 'h2')],
    });
    const change = result.resourceChanges.find((entry) => entry.resource === 'sf_core');
    expect(change?.kind).toBe('MODIFIED');
    expect(change?.details).toContain('File contents changed.');
    expect(change?.details.some((detail) => detail.includes('File count'))).toBe(true);
  });

  it('detects a declared version change', () => {
    const result = compare({
      beforeResources: [resource('sf_core', 'h1', { version: '1.0.0' })],
      afterResources: [resource('sf_core', 'h1', { version: '1.1.0' })],
    });
    expect(result.resourceChanges[0]?.details.some((detail) => detail.includes('version'))).toBe(true);
  });

  it('detects a configuration change', () => {
    const result = compare({ after: baseline('after', { configFingerprint: 'different' }) });
    expect(result.configurationChanged).toBe(true);
  });

  it('reports findings introduced and resolved', () => {
    const result = compare({ beforeFindings: [finding('a')], afterFindings: [finding('b')] });
    const kinds = new Map(result.findingChanges.map((change) => [change.findingId, change.kind]));
    expect(kinds.get('b')).toBe('INTRODUCED');
    expect(kinds.get('a')).toBe('RESOLVED');
  });

  it('reports a health delta only when both sides recorded a score', () => {
    expect(compare().healthDelta).toBeUndefined();
    const scored = compare({
      before: baseline('before', { healthScore: 90 }),
      after: baseline('after', { healthScore: 70 }),
    });
    expect(scored.healthDelta).toBe(-20);
  });

  it('says plainly when performance could not be compared', () => {
    const result = compare();
    expect(result.performance.compared).toBe(false);
    expect(result.performance.reason).toContain('No performance samples');
    expect(result.performance.regressions).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it('says so when only one side has samples, rather than implying no regression', () => {
    const samples = Array.from({ length: 20 }, () => ({ resource: 'sf_core', metric: 'tick', unit: 'ms', value: 0.2 }));
    const result = compare({ beforeSamples: samples, afterSamples: [] });
    expect(result.performance.compared).toBe(false);
    expect(result.performance.reason).toContain('only one of the two');
  });

  it('compares samples when both sides have them, and produces a regression finding', () => {
    const before = Array.from({ length: 30 }, () => ({ resource: 'sf_core', metric: 'tick', unit: 'ms', value: 0.21 }));
    const after = Array.from({ length: 30 }, () => ({ resource: 'sf_core', metric: 'tick', unit: 'ms', value: 0.87 }));
    const result = compare({ beforeSamples: before, afterSamples: after });

    expect(result.performance.compared).toBe(true);
    expect(result.performance.regressions).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe('PERF-REGRESSION-001');
  });

  it('is deterministic for the same input', () => {
    expect(JSON.stringify(compare().resourceChanges)).toBe(JSON.stringify(compare().resourceChanges));
  });
});
