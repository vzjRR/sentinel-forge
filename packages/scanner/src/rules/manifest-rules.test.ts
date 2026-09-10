import { describe, expect, it } from 'vitest';
import { createFixedClock } from '@sentinel-forge/core';
import { analyzeManifest } from '../manifest/manifest.js';
import type { DiscoveredResource } from '../discovery/discover.js';
import { analyzeManifestStructure, analyzeMissingFiles } from './manifest-rules.js';

const clock = createFixedClock(new Date('2026-01-01T00:00:00.000Z'));

function resource(overrides: Partial<DiscoveredResource> & { manifestSource?: string }): DiscoveredResource {
  const { manifestSource, ...rest } = overrides;
  return {
    name: 'sf_test',
    path: 'resources/sf_test',
    absolutePath: '/srv/resources/sf_test',
    manifestKind: 'fxmanifest',
    manifestPath: 'fxmanifest.lua',
    files: [],
    ...(manifestSource === undefined ? {} : { manifest: analyzeManifest(manifestSource) }),
    ...rest,
  };
}

function file(path: string): DiscoveredResource['files'][number] {
  return { path, serverPath: `resources/sf_test/${path}`, size: 10, hash: 'a'.repeat(64), modifiedAt: '2026-01-01T00:00:00.000Z' };
}

const HEALTHY = ["fx_version 'cerulean'", "game 'gta5'", "client_script 'client.lua'"].join('\n');

describe('CFG-MANIFEST-001', () => {
  it('reports nothing for a well-formed manifest', () => {
    const findings = analyzeManifestStructure({
      resource: resource({ manifestSource: HEALTHY, files: [file('fxmanifest.lua'), file('client.lua')] }),
      clock,
    });
    expect(findings).toEqual([]);
  });

  it('reports a resource directory with no manifest', () => {
    const findings = analyzeManifestStructure({
      resource: resource({ manifestKind: 'none', files: [file('readme.md')] }),
      clock,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'CFG-MANIFEST-001', severity: 'HIGH' });
    expect(findings[0]?.title).toContain('no manifest');
  });

  it('reports an unparsable manifest at the offending line', () => {
    const findings = analyzeManifestStructure({
      resource: resource({ manifestSource: "fx_version 'cerulean\ngame 'gta5'" }),
      clock,
    });
    expect(findings[0]?.title).toBe('Manifest cannot be parsed');
    expect(findings[0]?.line).toBe(1);
    expect(findings[0]?.evidence[0]?.location?.file).toBe('resources/sf_test/fxmanifest.lua');
  });

  it('does not also report missing declarations when the manifest cannot be parsed', () => {
    // One broken file should produce one problem statement, not three.
    const findings = analyzeManifestStructure({ resource: resource({ manifestSource: "fx_version 'cerulean" }), clock });
    expect(findings.every((finding) => finding.title === 'Manifest cannot be parsed')).toBe(true);
  });

  it('reports a missing fx_version', () => {
    const findings = analyzeManifestStructure({ resource: resource({ manifestSource: "game 'gta5'" }), clock });
    expect(findings.map((finding) => finding.title)).toContain('Manifest does not declare fx_version');
  });

  it('reports a missing game declaration', () => {
    const findings = analyzeManifestStructure({ resource: resource({ manifestSource: "fx_version 'cerulean'" }), clock });
    expect(findings.map((finding) => finding.title)).toContain('Manifest does not declare a game');
  });

  it('accepts every documented fx_version', () => {
    for (const version of ['cerulean', 'bodacious', 'adamant']) {
      const findings = analyzeManifestStructure({
        resource: resource({ manifestSource: `fx_version '${version}'\ngame 'gta5'` }),
        clock,
      });
      expect(findings, version).toEqual([]);
    }
  });

  it('reports an unrecognised fx_version at low confidence, since a newer one may exist', () => {
    const findings = analyzeManifestStructure({
      resource: resource({ manifestSource: "fx_version 'viridian'\ngame 'gta5'" }),
      clock,
    });
    expect(findings[0]?.title).toBe('Unrecognised fx_version');
    expect(findings[0]?.severity).toBe('LOW');
    expect(findings[0]?.confidence).toBeLessThanOrEqual(0.5);
  });

  it('notes the legacy manifest format at INFO, without demanding a change', () => {
    const findings = analyzeManifestStructure({
      resource: resource({
        manifestKind: '__resource',
        manifestPath: '__resource.lua',
        manifestSource: "resource_manifest_version '44febabe-d386-4d18-afbe-5e627f4af937'",
      }),
      clock,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'INFO' });
    expect(findings[0]?.title).toContain('legacy manifest');
  });

  it('reports an unreadable manifest rather than treating it as absent', () => {
    const findings = analyzeManifestStructure({
      resource: resource({ manifestUnreadable: true }),
      clock,
    });
    expect(findings[0]?.title).toBe('Manifest could not be read');
  });
});

describe('CFG-MISSING-FILE-001', () => {
  it('reports nothing when every declared file exists', () => {
    const findings = analyzeMissingFiles({
      resource: resource({ manifestSource: HEALTHY, files: [file('fxmanifest.lua'), file('client.lua')] }),
      clock,
    });
    expect(findings).toEqual([]);
  });

  it('reports a literal path that does not exist, at high confidence', () => {
    const findings = analyzeMissingFiles({
      resource: resource({
        manifestSource: "fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client/missing.lua'",
        files: [file('fxmanifest.lua')],
      }),
      clock,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'CFG-MISSING-FILE-001', severity: 'HIGH', line: 3 });
    expect(findings[0]?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('treats a glob matching nothing as weaker evidence than a missing literal path', () => {
    const findings = analyzeMissingFiles({
      resource: resource({
        manifestSource: "fx_version 'cerulean'\ngame 'gta5'\nclient_scripts { 'client/*.lua' }",
        files: [file('fxmanifest.lua')],
      }),
      clock,
    });
    expect(findings[0]).toMatchObject({ severity: 'MEDIUM' });
    expect(findings[0]?.confidence).toBeLessThan(0.9);
  });

  it('accepts a glob that matches at least one file', () => {
    const findings = analyzeMissingFiles({
      resource: resource({
        manifestSource: "fx_version 'cerulean'\ngame 'gta5'\nclient_scripts { 'client/**/*.lua' }",
        files: [file('fxmanifest.lua'), file('client/ui/hud.lua')],
      }),
      clock,
    });
    expect(findings).toEqual([]);
  });

  it('ignores @resource references, which belong to another resource', () => {
    const findings = analyzeMissingFiles({
      resource: resource({
        manifestSource: "fx_version 'cerulean'\ngame 'gta5'\nshared_script '@ox_lib/init.lua'",
        files: [file('fxmanifest.lua')],
      }),
      clock,
    });
    expect(findings).toEqual([]);
  });

  it('checks ui_page and files declarations too', () => {
    const findings = analyzeMissingFiles({
      resource: resource({
        manifestSource: [
          "fx_version 'cerulean'",
          "game 'gta5'",
          "ui_page 'html/index.html'",
          "file 'html/app.js'",
        ].join('\n'),
        files: [file('fxmanifest.lua')],
      }),
      clock,
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.line).sort()).toEqual([3, 4]);
  });

  it('produces a stable id for the same observation', () => {
    const build = (): string => {
      const findings = analyzeMissingFiles({
        resource: resource({
          manifestSource: "fx_version 'cerulean'\ngame 'gta5'\nclient_script 'a.lua'",
          files: [file('fxmanifest.lua')],
        }),
        clock,
      });
      return findings[0]?.id ?? '';
    };
    expect(build()).toBe(build());
  });
});
