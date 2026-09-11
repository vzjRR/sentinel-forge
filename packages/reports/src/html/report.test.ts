import { describe, expect, it } from 'vitest';
import type { Finding, SentinelReport } from '@sentinel-forge/shared';
import { escapeHtml, slug } from './escape.js';
import { renderHtmlReport } from './report.js';

const FINDING: Finding = {
  id: 'fnd_1',
  ruleId: 'PERF-LOOP-001',
  category: 'PERFORMANCE',
  severity: 'HIGH',
  confidence: 0.8,
  title: 'Loop without an observable yield',
  summary: 'A loop runs without yielding.',
  recommendation: 'Add a Wait call.',
  evidence: [
    {
      kind: 'CODE_PATTERN',
      description: 'while true do',
      location: { file: 'resources/sf_core/server/main.lua', line: 12 },
      excerpt: 'while true do\n  heavyWork()\nend',
    },
  ],
  resource: 'sf_core',
  file: 'resources/sf_core/server/main.lua',
  line: 12,
  timestamp: '2026-01-01T00:00:00.000Z',
};

function report(overrides: Partial<SentinelReport> = {}): SentinelReport {
  return {
    schemaVersion: '1.2',
    generatedAt: '2026-01-01T00:00:00.000Z',
    metadata: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      productVersion: '0.6.0',
      command: 'scan',
      durationMs: 120,
      hostPlatform: 'linux-x64',
      nodeVersion: 'v22.22.2',
    },
    server: {
      id: 'srv_1',
      path: '/opt/fxserver',
      configPath: 'server.cfg',
      resourceRoots: ['resources'],
      resourceCount: 1,
      fingerprint: 'a'.repeat(64),
      scannedAt: '2026-01-01T00:00:00.000Z',
    },
    resources: [
      {
        resource: {
          name: 'sf_core',
          path: 'resources/sf_core',
          manifestKind: 'fxmanifest',
          declaredDependencies: [],
          fileCount: 3,
        },
        findingIds: ['fnd_1'],
      },
    ],
    findings: [FINDING],
    incidents: [],
    limitations: ['Findings are observations, not proven runtime behaviour.'],
    ...overrides,
  };
}

describe('renderHtmlReport', () => {
  it('renders a complete, self-contained document', () => {
    const html = renderHtmlReport(report());

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
    // Self-contained means no request leaves the document when it is opened.
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<img[^>]+src="http/i);
    expect(html).not.toMatch(/<script/i);
  });

  it('declares a content security policy that permits no network access', () => {
    const html = renderHtmlReport(report());
    expect(html).toContain("default-src 'none'");
  });

  it('escapes hostile text from a scanned server everywhere it appears', () => {
    // Every one of these is a place third-party text reaches the document:
    // a resource name, a file path, a finding title, and a source excerpt.
    const attack = '</pre><script>alert(1)</script>';
    const hostile = report({
      server: { ...report().server, path: `/opt/${attack}` },
      resources: [
        {
          resource: {
            name: attack,
            path: 'resources/x',
            manifestKind: 'fxmanifest',
            declaredDependencies: [],
            fileCount: 1,
          },
          findingIds: ['fnd_1'],
        },
      ],
      findings: [
        {
          ...FINDING,
          title: attack,
          summary: attack,
          recommendation: attack,
          resource: attack,
          file: attack,
          evidence: [{ kind: 'CODE_PATTERN', description: attack, excerpt: attack }],
        },
      ],
      limitations: [attack],
    });

    const html = renderHtmlReport(hostile);

    // The literal payload must not survive anywhere in the document.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('</pre><script>');
    // It must still be visible to the reader, escaped.
    expect(html).toContain(escapeHtml(attack));
  });

  it('says a section was not collected rather than omitting or emptying it', () => {
    const html = renderHtmlReport(report());

    // Nothing in this report carries security, integrity or runtime data.
    expect(html).toContain('Not collected');
    expect(html).toContain('Security');
    expect(html).toContain('Integrity');
    // An absent section must never read as a clean one.
    expect(html).not.toContain('No security issues found');
  });

  it('distinguishes an installed collector with no samples from no collector', () => {
    const withCollector = renderHtmlReport(
      report({
        performance: {
          sampleCount: 0,
          regressions: [],
          collected: false,
          runtime: {
            collectorInstalled: true,
            documentCount: 0,
            sampleCount: 0,
            eventCount: 0,
            metrics: [],
            resourcesObserved: [],
            dropped: { samples: 0, events: 0 },
            unreadable: [],
            limitation: 'No per-resource timing is collected.',
          },
        },
      }),
    );
    expect(withCollector).toContain('collector installed, nothing measured yet');

    const withoutCollector = renderHtmlReport(
      report({ performance: { sampleCount: 0, regressions: [], collected: false } }),
    );
    expect(withoutCollector).toContain('collector is not installed');
  });

  it('always renders the limitations section', () => {
    const html = renderHtmlReport(report());
    expect(html).toContain('Limitations');
    expect(html).toContain('Findings are observations, not proven runtime behaviour.');
  });

  it('shows severity and confidence as separate values', () => {
    const html = renderHtmlReport(report());
    expect(html).toContain('HIGH');
    expect(html).toContain('confidence 0.80');
  });

  it('states the independence notice', () => {
    expect(renderHtmlReport(report())).toContain('not affiliated with');
  });
});

describe('slug', () => {
  it('reduces hostile text to a safe token', () => {
    expect(slug('sf_shop" onmouseover="x')).toBe('sf_shop-onmouseover-x');
    expect(slug('[local]')).toBe('local');
    expect(slug('///')).toBe('x');
  });
});
