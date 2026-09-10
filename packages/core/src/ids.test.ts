import { describe, expect, it } from 'vitest';
import { deterministicId, findingId, incidentId, resourceId, runId, serverId } from './ids.js';

describe('identifiers', () => {
  it('produces the same finding id for the same input, so reports can be diffed', () => {
    const first = findingId('PERF-LOOP-001', 'sf_heavy', 'client.lua', 145);
    const second = findingId('PERF-LOOP-001', 'sf_heavy', 'client.lua', 145);
    expect(first).toBe(second);
    expect(first).toMatch(/^fnd_[0-9a-f]{16}$/);
  });

  it('distinguishes findings that differ in any component', () => {
    const base = findingId('PERF-LOOP-001', 'sf_heavy', 'client.lua', 145);
    expect(findingId('PERF-EVENT-001', 'sf_heavy', 'client.lua', 145)).not.toBe(base);
    expect(findingId('PERF-LOOP-001', 'sf_core', 'client.lua', 145)).not.toBe(base);
    expect(findingId('PERF-LOOP-001', 'sf_heavy', 'server.lua', 145)).not.toBe(base);
    expect(findingId('PERF-LOOP-001', 'sf_heavy', 'client.lua', 146)).not.toBe(base);
  });

  it('separates two findings at the same location with a discriminator', () => {
    const first = findingId('SEC-SECRET-001', 'sf_suspicious', 'server.lua', 4, 'webhook');
    const second = findingId('SEC-SECRET-001', 'sf_suspicious', 'server.lua', 4, 'api-key');
    expect(first).not.toBe(second);
  });

  it('treats an absent component differently from an empty one', () => {
    expect(deterministicId('x', 'a', '')).not.toBe(deterministicId('x', '', 'a'));
  });

  it('derives stable server and resource ids from their identity', () => {
    expect(serverId('/opt/fxserver')).toBe(serverId('/opt/fxserver'));
    expect(resourceId('srv_1', 'sf_core')).not.toBe(resourceId('srv_1', 'sf_hud'));
  });

  it('generates a distinct id for each run and incident', () => {
    expect(runId()).not.toBe(runId());
    expect(incidentId()).not.toBe(incidentId());
    expect(runId()).toMatch(/^run_[0-9a-f-]{36}$/);
  });
});
