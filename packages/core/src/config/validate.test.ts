import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './schema.js';
import { validateConfig } from './validate.js';

describe('configuration validation', () => {
  it('returns the documented defaults for empty input', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(true);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it('defaults to local-only, read-only behaviour', () => {
    const { config } = validateConfig({});
    expect(config.privacy).toEqual({ telemetry: false, network: false, ai: false });
    expect(config.scan.followSymlinks).toBe(false);
    expect(config.server.path).toBeNull();
  });

  it('merges a partial configuration over the defaults per section', () => {
    const { config } = validateConfig({ scan: { maxDepth: 8 } });
    expect(config.scan.maxDepth).toBe(8);
    expect(config.scan.maxFiles).toBe(DEFAULT_CONFIG.scan.maxFiles);
  });

  it('rejects a non-object configuration', () => {
    expect(validateConfig('nope').valid).toBe(false);
    expect(validateConfig([]).valid).toBe(false);
  });

  it('reports unknown sections rather than ignoring them', () => {
    const result = validateConfig({ dashboard: { port: 8080 } });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toBe('dashboard');
  });

  it('tolerates a $schema key so editors can offer completion', () => {
    expect(validateConfig({ $schema: './schema.json' }).valid).toBe(true);
  });

  it('validates numeric limits', () => {
    expect(validateConfig({ scan: { maxDepth: 0 } }).valid).toBe(false);
    expect(validateConfig({ scan: { maxDepth: 500 } }).valid).toBe(false);
    expect(validateConfig({ scan: { maxFileBytes: 10 } }).valid).toBe(false);
    expect(validateConfig({ scan: { maxFiles: -1 } }).valid).toBe(false);
    expect(validateConfig({ retention: { scanRunDays: -1 } }).valid).toBe(false);
    expect(validateConfig({ retention: { scanRunDays: 0 } }).valid).toBe(true);
  });

  it('validates severities and log levels against their enumerations', () => {
    expect(validateConfig({ analysis: { minimumSeverity: 'SEVERE' } }).valid).toBe(false);
    expect(validateConfig({ analysis: { failOnSeverity: 'CRITICAL' } }).valid).toBe(true);
    expect(validateConfig({ logging: { level: 'TRACE' } }).valid).toBe(false);
    expect(validateConfig({ logging: { format: 'xml' } }).valid).toBe(false);
  });

  it('rejects disabling a rule id that is not in the catalog', () => {
    expect(validateConfig({ analysis: { disabledRules: ['DEP-MISSING-001'] } }).valid).toBe(true);
    const result = validateConfig({ analysis: { disabledRules: ['NOT-A-RULE'] } });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('NOT-A-RULE');
  });

  it('refuses to enable a capability this build does not have', () => {
    for (const key of ['telemetry', 'network', 'ai'] as const) {
      const result = validateConfig({ privacy: { [key]: true } });
      expect(result.valid, key).toBe(false);
      expect(result.issues[0]?.message, key).toContain('NOT IMPLEMENTED');
    }
  });

  it('collects every issue in a single pass', () => {
    const result = validateConfig({
      scan: { maxDepth: 0, maxFiles: -1 },
      logging: { level: 'TRACE' },
      analysis: { minimumSeverity: 'SEVERE' },
    });
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
  });
});
