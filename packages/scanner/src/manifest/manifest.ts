/**
 * Typed view of a parsed manifest.
 *
 * Turns the flat directive list into the fields the rest of the scanner needs,
 * while keeping every value's source position so a finding can point at the
 * exact line that declared it.
 */

import { parseManifest, type ManifestDirective, type ManifestProblem, type ManifestValue } from './parser.js';

/** fx_version values documented by Cfx.re, newest first. */
export const KNOWN_FX_VERSIONS: readonly string[] = Object.freeze(['cerulean', 'bodacious', 'adamant']);

/** Game identifiers accepted by the `game`/`games` directive. */
export const KNOWN_GAMES: readonly string[] = Object.freeze(['gta5', 'rdr3', 'common']);

export type ScriptKind = 'client' | 'server' | 'shared';

export interface ScriptEntry {
  readonly kind: ScriptKind;
  /** Declared path or glob, exactly as written. */
  readonly pattern: string;
  readonly line: number;
  readonly column: number;
  /**
   * Resource named by an `@resource/path` reference, when the entry points at
   * another resource's file. Such an entry implies a dependency.
   */
  readonly externalResource?: string;
}

export interface FileEntry {
  readonly pattern: string;
  readonly line: number;
  readonly column: number;
  readonly externalResource?: string;
}

export interface DependencyEntry {
  readonly name: string;
  readonly line: number;
  readonly column: number;
  /**
   * True for entries beginning with `/`, which are runtime constraints such as
   * `/server:4500`, `/onesync` or `/gameBuild:h4` — not resource names.
   * Reporting those as missing resources would be a false positive.
   */
  readonly isRuntimeConstraint: boolean;
}

export interface ResourceManifest {
  readonly fxVersion?: ManifestValue;
  readonly games: readonly ManifestValue[];
  readonly author?: ManifestValue;
  readonly description?: ManifestValue;
  readonly version?: ManifestValue;
  readonly scripts: readonly ScriptEntry[];
  readonly files: readonly FileEntry[];
  readonly uiPage?: ManifestValue;
  readonly dependencies: readonly DependencyEntry[];
  /** Names this resource declares it provides, satisfying others' dependencies. */
  readonly provides: readonly ManifestValue[];
  readonly dataFiles: readonly ManifestValue[];
  readonly directives: readonly ManifestDirective[];
  readonly problems: readonly ManifestProblem[];
}

const SCRIPT_DIRECTIVES: Readonly<Record<string, ScriptKind>> = Object.freeze({
  client_scripts: 'client',
  server_scripts: 'server',
  shared_scripts: 'shared',
});

/**
 * Splits an `@resource/path` reference.
 * Returns the resource name and the remaining path, or `null` when the value is
 * an ordinary resource-relative path.
 */
export function splitExternalReference(value: string): { resource: string; path: string } | null {
  if (!value.startsWith('@')) return null;
  const separator = value.indexOf('/');
  if (separator === -1) return { resource: value.slice(1), path: '' };
  return { resource: value.slice(1, separator), path: value.slice(separator + 1) };
}

export function analyzeManifest(source: string): ResourceManifest {
  const { directives, problems } = parseManifest(source);

  const scripts: ScriptEntry[] = [];
  const files: FileEntry[] = [];
  const dependencies: DependencyEntry[] = [];
  const provides: ManifestValue[] = [];
  const dataFiles: ManifestValue[] = [];
  const games: ManifestValue[] = [];

  let fxVersion: ManifestValue | undefined;
  let author: ManifestValue | undefined;
  let description: ManifestValue | undefined;
  let version: ManifestValue | undefined;
  let uiPage: ManifestValue | undefined;

  for (const directive of directives) {
    const scriptKind = SCRIPT_DIRECTIVES[directive.key];
    if (scriptKind !== undefined) {
      for (const entry of directive.values) {
        const external = splitExternalReference(entry.value);
        scripts.push({
          kind: scriptKind,
          pattern: external === null ? entry.value : external.path,
          line: entry.line,
          column: entry.column,
          ...(external === null ? {} : { externalResource: external.resource }),
        });
      }
      continue;
    }

    switch (directive.key) {
      case 'fx_version':
        fxVersion ??= directive.values[0];
        break;
      case 'games':
        games.push(...directive.values);
        break;
      case 'author':
        author ??= directive.values[0];
        break;
      case 'description':
        description ??= directive.values[0];
        break;
      case 'version':
        version ??= directive.values[0];
        break;
      case 'ui_page':
        uiPage ??= directive.values[0];
        break;
      case 'files':
        for (const entry of directive.values) {
          const external = splitExternalReference(entry.value);
          files.push({
            pattern: external === null ? entry.value : external.path,
            line: entry.line,
            column: entry.column,
            ...(external === null ? {} : { externalResource: external.resource }),
          });
        }
        break;
      case 'dependencies':
        for (const entry of directive.values) {
          dependencies.push({
            name: entry.value,
            line: entry.line,
            column: entry.column,
            isRuntimeConstraint: entry.value.startsWith('/'),
          });
        }
        break;
      case 'provides':
        provides.push(...directive.values);
        break;
      case 'data_file':
        // `data_file 'TYPE' 'path'` — the path is the second value.
        if (directive.values.length >= 2) {
          const path = directive.values[1];
          if (path !== undefined) dataFiles.push(path);
        }
        break;
      default:
        break;
    }
  }

  return {
    ...(fxVersion === undefined ? {} : { fxVersion }),
    games,
    ...(author === undefined ? {} : { author }),
    ...(description === undefined ? {} : { description }),
    ...(version === undefined ? {} : { version }),
    scripts,
    files,
    ...(uiPage === undefined ? {} : { uiPage }),
    dependencies,
    provides,
    dataFiles,
    directives,
    problems,
  };
}
