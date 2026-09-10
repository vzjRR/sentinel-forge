/**
 * Configuration and manifest rules.
 *
 * CFG-MANIFEST-001      the manifest is malformed or incomplete
 * CFG-MISSING-FILE-001  the manifest references a file that is not on disk
 *
 * Both operate on already-parsed data. Nothing here reads the filesystem, so
 * the rules are testable against a literal manifest string and a file list.
 */

import { createFinding, type Clock } from '@sentinel-forge/core';
import type { Evidence, Finding } from '@sentinel-forge/shared';
import { KNOWN_FX_VERSIONS, KNOWN_GAMES } from '../manifest/manifest.js';
import { isGlob, matchGlob } from '../glob.js';
import type { DiscoveredResource } from '../discovery/discover.js';

export interface ManifestRuleContext {
  readonly resource: DiscoveredResource;
  readonly clock: Clock;
}

/** Path of the manifest relative to the server root, for evidence locations. */
function manifestLocation(resource: DiscoveredResource): string {
  return `${resource.path}/${resource.manifestPath ?? 'fxmanifest.lua'}`;
}

/**
 * CFG-MANIFEST-001 — malformed or incomplete manifest.
 *
 * Three distinct conditions, reported separately so each one is actionable:
 * a resource directory with no manifest at all; a manifest that could not be
 * lexed; and a manifest missing a declaration the server requires.
 */
export function analyzeManifestStructure(context: ManifestRuleContext): Finding[] {
  const { resource, clock } = context;
  const timestamp = clock.now().toISOString();
  const findings: Finding[] = [];

  if (resource.manifestKind === 'none') {
    // A directory under a resource root with no manifest is not loadable as a
    // resource. Confidence is high but not absolute: the directory may be a
    // deliberate container for shared assets.
    findings.push(
      createFinding({
        ruleId: 'CFG-MANIFEST-001',
        severity: 'HIGH',
        confidence: 0.85,
        title: 'Resource directory has no manifest',
        summary: `The directory "${resource.name}" sits in a resource root but contains neither fxmanifest.lua nor __resource.lua, so the server cannot load it as a resource.`,
        recommendation:
          'Add an fxmanifest.lua, or move the directory out of the resource root if it is not a resource.',
        evidence: [
          {
            kind: 'FILE_REFERENCE',
            description: 'Resource directory containing no manifest file.',
            location: { file: resource.path },
            metadata: { fileCount: resource.files.length },
          },
        ],
        resource: resource.name,
        file: resource.path,
        timestamp,
        discriminator: 'no-manifest',
      }),
    );
    return findings;
  }

  const manifest = resource.manifest;
  if (manifest === undefined) {
    if (resource.manifestUnreadable === true) {
      findings.push(
        createFinding({
          ruleId: 'CFG-MANIFEST-001',
          severity: 'MEDIUM',
          confidence: 0.9,
          title: 'Manifest could not be read',
          summary: `The manifest for "${resource.name}" exists but could not be read, so its declarations were not analyzed.`,
          recommendation: 'Check the file permissions and size limits, then re-run the scan.',
          evidence: [
            {
              kind: 'FILE_REFERENCE',
              description: 'Manifest present on disk but unreadable during the scan.',
              location: { file: manifestLocation(resource) },
            },
          ],
          resource: resource.name,
          file: manifestLocation(resource),
          timestamp,
          discriminator: 'unreadable',
        }),
      );
    }
    return findings;
  }

  const file = manifestLocation(resource);

  // Lexical problems: an unterminated string or comment means the server's own
  // Lua parser will reject the file, so the resource does not start at all.
  for (const problem of manifest.problems) {
    if (problem.kind !== 'UNTERMINATED_STRING' && problem.kind !== 'UNTERMINATED_COMMENT') continue;
    findings.push(
      createFinding({
        ruleId: 'CFG-MANIFEST-001',
        severity: 'HIGH',
        confidence: 0.95,
        title: 'Manifest cannot be parsed',
        summary: `${problem.message} A manifest that cannot be parsed prevents the resource from starting.`,
        recommendation: 'Correct the syntax at the reported line and re-run the scan.',
        evidence: [
          {
            kind: 'CODE_PATTERN',
            description: problem.message,
            location: { file, line: problem.line, column: problem.column },
          },
        ],
        resource: resource.name,
        file,
        line: problem.line,
        timestamp,
        discriminator: `syntax-${String(problem.line)}-${String(problem.column)}`,
      }),
    );
  }

  // A manifest that failed to lex will also look like it is missing required
  // declarations; reporting both would be one problem stated twice.
  const hasSyntaxProblem = findings.length > 0;
  if (hasSyntaxProblem) return findings;

  if (manifest.fxVersion === undefined && resource.manifestKind === 'fxmanifest') {
    findings.push(
      createFinding({
        ruleId: 'CFG-MANIFEST-001',
        severity: 'MEDIUM',
        confidence: 0.9,
        title: 'Manifest does not declare fx_version',
        summary: `The manifest for "${resource.name}" declares no fx_version, so the runtime behaviour the resource expects is unspecified.`,
        recommendation: `Declare a documented fx_version, for example: fx_version '${KNOWN_FX_VERSIONS[0] ?? 'cerulean'}'.`,
        evidence: [
          {
            kind: 'FILE_REFERENCE',
            description: 'Manifest with no fx_version declaration.',
            location: { file },
          },
        ],
        resource: resource.name,
        file,
        timestamp,
        discriminator: 'missing-fx-version',
      }),
    );
  } else if (manifest.fxVersion !== undefined && !KNOWN_FX_VERSIONS.includes(manifest.fxVersion.value)) {
    // Lower confidence: Cfx.re may publish a version this build predates.
    findings.push(
      createFinding({
        ruleId: 'CFG-MANIFEST-001',
        severity: 'LOW',
        confidence: 0.5,
        title: 'Unrecognised fx_version',
        summary: `The manifest declares fx_version "${manifest.fxVersion.value}", which is not one of the versions known to this build (${KNOWN_FX_VERSIONS.join(', ')}).`,
        recommendation:
          'Confirm the value against the official resource manifest documentation. A newer version may exist than this build knows about.',
        evidence: [
          {
            kind: 'CONFIG_VALUE',
            description: 'Declared fx_version value.',
            location: { file, line: manifest.fxVersion.line, column: manifest.fxVersion.column },
            excerpt: `fx_version '${manifest.fxVersion.value}'`,
          },
        ],
        resource: resource.name,
        file,
        line: manifest.fxVersion.line,
        timestamp,
        discriminator: 'unknown-fx-version',
      }),
    );
  }

  if (manifest.games.length === 0 && resource.manifestKind === 'fxmanifest') {
    findings.push(
      createFinding({
        ruleId: 'CFG-MANIFEST-001',
        severity: 'LOW',
        confidence: 0.8,
        title: 'Manifest does not declare a game',
        summary: `The manifest for "${resource.name}" declares no game, so which API set the resource targets is unspecified.`,
        recommendation: "Declare the target game, for example: game 'gta5'.",
        evidence: [
          {
            kind: 'FILE_REFERENCE',
            description: 'Manifest with no game or games declaration.',
            location: { file },
          },
        ],
        resource: resource.name,
        file,
        timestamp,
        discriminator: 'missing-game',
      }),
    );
  }

  for (const game of manifest.games) {
    if (KNOWN_GAMES.includes(game.value)) continue;
    findings.push(
      createFinding({
        ruleId: 'CFG-MANIFEST-001',
        severity: 'LOW',
        confidence: 0.5,
        title: 'Unrecognised game identifier',
        summary: `The manifest declares game "${game.value}", which is not one of the identifiers known to this build (${KNOWN_GAMES.join(', ')}).`,
        recommendation: 'Confirm the identifier against the official resource manifest documentation.',
        evidence: [
          {
            kind: 'CONFIG_VALUE',
            description: 'Declared game identifier.',
            location: { file, line: game.line, column: game.column },
            excerpt: `game '${game.value}'`,
          },
        ],
        resource: resource.name,
        file,
        line: game.line,
        timestamp,
        discriminator: `unknown-game-${game.value}`,
      }),
    );
  }

  if (resource.manifestKind === '__resource') {
    findings.push(
      createFinding({
        ruleId: 'CFG-MANIFEST-001',
        severity: 'INFO',
        confidence: 0.95,
        title: 'Resource uses the legacy manifest format',
        summary: `"${resource.name}" declares its metadata in __resource.lua. fxmanifest.lua is the current format.`,
        recommendation:
          'Migrating to fxmanifest.lua is optional while the legacy format is still loaded, but it is the supported path forward.',
        evidence: [
          {
            kind: 'FILE_REFERENCE',
            description: 'Legacy __resource.lua manifest.',
            location: { file },
          },
        ],
        resource: resource.name,
        file,
        timestamp,
        discriminator: 'legacy-manifest',
      }),
    );
  }

  return findings;
}

/**
 * CFG-MISSING-FILE-001 — a manifest declaration resolves to no file on disk.
 *
 * Cross-resource references (`@other/file.lua`) are excluded: whether that file
 * exists is a property of the other resource, and the dependency it implies is
 * handled by the dependency engine instead.
 */
export function analyzeMissingFiles(context: ManifestRuleContext): Finding[] {
  const { resource, clock } = context;
  const manifest = resource.manifest;
  if (manifest === undefined) return [];

  const timestamp = clock.now().toISOString();
  const file = manifestLocation(resource);
  const available = resource.files.map((entry) => entry.path);
  const findings: Finding[] = [];

  interface Declaration {
    readonly pattern: string;
    readonly line: number;
    readonly column: number;
    readonly directive: string;
    readonly externalResource?: string;
  }

  const declarations: Declaration[] = [
    ...manifest.scripts.map((script) => ({
      pattern: script.pattern,
      line: script.line,
      column: script.column,
      directive: `${script.kind}_script`,
      ...(script.externalResource === undefined ? {} : { externalResource: script.externalResource }),
    })),
    ...manifest.files.map((entry) => ({
      pattern: entry.pattern,
      line: entry.line,
      column: entry.column,
      directive: 'file',
      ...(entry.externalResource === undefined ? {} : { externalResource: entry.externalResource }),
    })),
    ...(manifest.uiPage === undefined
      ? []
      : [
          {
            pattern: manifest.uiPage.value,
            line: manifest.uiPage.line,
            column: manifest.uiPage.column,
            directive: 'ui_page',
          },
        ]),
  ];

  for (const declaration of declarations) {
    if (declaration.externalResource !== undefined) continue;
    if (declaration.pattern.length === 0) continue;

    const matches = matchGlob(declaration.pattern, available);
    if (matches.length > 0) continue;

    const patternIsGlob = isGlob(declaration.pattern);
    const evidence: Evidence[] = [
      {
        kind: 'FILE_REFERENCE',
        description: `Manifest declares ${declaration.directive} "${declaration.pattern}", which matches no file in the resource.`,
        location: { file, line: declaration.line, column: declaration.column },
        excerpt: `${declaration.directive} '${declaration.pattern}'`,
      },
      {
        kind: 'CONFIG_VALUE',
        description: 'Files present in the resource directory.',
        metadata: { fileCount: available.length },
      },
    ];

    findings.push(
      createFinding({
        ruleId: 'CFG-MISSING-FILE-001',
        severity: patternIsGlob ? 'MEDIUM' : 'HIGH',
        // A literal path either exists or it does not. A glob matching nothing
        // is a weaker signal: it may be an intentionally optional file set.
        confidence: patternIsGlob ? 0.6 : 0.95,
        title: patternIsGlob ? 'Manifest pattern matches no file' : 'Manifest references a file that does not exist',
        summary: patternIsGlob
          ? `The pattern "${declaration.pattern}" declared by ${declaration.directive} matches no file in "${resource.name}".`
          : `${declaration.directive} declares "${declaration.pattern}", but that file does not exist in "${resource.name}". The script will not load.`,
        recommendation: patternIsGlob
          ? 'Confirm the pattern is correct, or remove it if the file set is no longer present.'
          : 'Add the missing file, correct the path, or remove the declaration.',
        evidence,
        resource: resource.name,
        file,
        line: declaration.line,
        timestamp,
        discriminator: `${declaration.directive}:${declaration.pattern}`,
      }),
    );
  }

  return findings;
}
