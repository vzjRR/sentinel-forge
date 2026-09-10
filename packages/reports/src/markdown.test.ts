import { describe, expect, it } from 'vitest';
import { REPORT_SCHEMA_VERSION, type Finding, type SentinelReport } from '@sentinel-forge/shared';
import { renderMarkdownReport } from './markdown.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'fnd_1',
    ruleId: 'DEP-MISSING-001',
    category: 'DEPENDENCIES',
    severity: 'HIGH',
    confidence: 0.95,
    title: 'Declared dependency was not found',
    summary: 'sf_shop depends on sf_inventory, which was not found.',
    recommendation: 'Install sf_inventory.',
    evidence: [
      {
        kind: 'RELATIONSHIP',
        description: 'Unresolved dependency edge.',
        location: { file: 'resources/sf_shop/fxmanifest.lua', line: 7 },
      },
    ],
    resource: 'sf_shop',
    file: 'resources/sf_shop/fxmanifest.lua',
    line: 7,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function report(overrides: Partial<SentinelReport> = {}): SentinelReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      productVersion: '0.1.0',
      command: 'scan',
      durationMs: 42,
      hostPlatform: 'linux-x64',
      nodeVersion: 'v22.22.2',
    },
    server: {
      id: 'srv_1',
      path: '/srv/fixture',
      configPath: 'server.cfg',
      resourceRoots: ['resources'],
      resourceCount: 1,
      fingerprint: 'abcdef0123456789abcdef',
      scannedAt: '2026-01-01T00:00:00.000Z',
    },
    resources: [
      {
        resource: {
          name: 'sf_shop',
          path: 'resources/sf_shop',
          manifestKind: 'fxmanifest',
          declaredDependencies: ['sf_inventory'],
          fileCount: 3,
        },
        findingIds: ['fnd_1'],
      },
    ],
    findings: [finding()],
    dependencies: {
      edges: [{ from: 'sf_shop', to: 'sf_inventory', kind: 'DECLARED', resolved: false }],
      unresolved: [{ from: 'sf_shop', to: 'sf_inventory', kind: 'DECLARED', resolved: false }],
      cycles: [['sf_a', 'sf_b']],
    },
    incidents: [],
    limitations: ['Findings are indicators and require verification.'],
    ...overrides,
  };
}

describe('Markdown report rendering', () => {
  const output = renderMarkdownReport(report());

  it('states the server, the command and the duration', () => {
    expect(output).toContain('# Sentinel Forge report');
    expect(output).toContain('/srv/fixture');
    expect(output).toContain('`scan`');
    expect(output).toContain('42 ms');
  });

  it('says health was not collected rather than showing a zero', () => {
    expect(output).toContain('_Not collected._');
    expect(output).not.toMatch(/\*\*0\/100\*\*/);
  });

  it('groups findings by severity with a count table', () => {
    expect(output).toContain('### HIGH (1)');
    expect(output).toContain('| HIGH | 1 |');
    expect(output).toContain('| **Total** | **1** |');
  });

  it('shows the rule, confidence band, location and recommendation for each finding', () => {
    expect(output).toContain('`DEP-MISSING-001`');
    expect(output).toContain('0.95 (Very high)');
    expect(output).toContain('`resources/sf_shop/fxmanifest.lua:7`');
    expect(output).toContain('**Recommendation:** Install sf_inventory.');
  });

  it('renders evidence with its location', () => {
    expect(output).toContain('**Evidence**');
    expect(output).toContain('Unresolved dependency edge.');
  });

  it('renders unresolved dependencies and cycles', () => {
    expect(output).toContain('### Unresolved');
    expect(output).toContain('### Cycles');
    expect(output).toContain('`sf_a` → `sf_b` → `sf_a`');
  });

  it('always renders the limitations section', () => {
    expect(output).toContain('## Limitations');
    expect(output).toContain('Findings are indicators and require verification.');
  });

  it('states plainly when there are no findings', () => {
    expect(renderMarkdownReport(report({ findings: [] }))).toContain('No findings were reported');
  });

  it('escapes pipes so a value cannot break the table layout', () => {
    const rendered = renderMarkdownReport(
      report({
        resources: [
          {
            resource: {
              name: 'sf|pipe',
              path: 'resources/sf_pipe',
              manifestKind: 'fxmanifest',
              declaredDependencies: [],
              fileCount: 1,
            },
            findingIds: [],
          },
        ],
      }),
    );
    expect(rendered).toContain('sf\\|pipe');
  });

  it('is deterministic for identical input', () => {
    expect(renderMarkdownReport(report())).toBe(renderMarkdownReport(report()));
  });
});
