/**
 * Configuration loading.
 *
 * Resolution order, highest precedence first:
 *   1. explicit overrides supplied by the caller (CLI flags),
 *   2. the configuration file (explicit path, or the nearest
 *      `sentinel.config.json` at or above the working directory),
 *   3. built-in defaults.
 *
 * Environment variables are deliberately not part of this chain. Diagnostic
 * output must be reproducible from a path and a file; an invisible environment
 * override would make two identical commands behave differently.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { SentinelConfigError } from '../errors.js';
import { validateConfig } from './validate.js';
import { CONFIG_FILE_NAME, type PartialSentinelConfig, type SentinelConfig } from './schema.js';

export interface LoadConfigOptions {
  /** Directory the search starts from. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Explicit configuration file path. Missing file is an error when set. */
  readonly configPath?: string;
  /** Overrides applied after the file is read, typically from CLI flags. */
  readonly overrides?: PartialSentinelConfig;
  /** When false, no configuration file is read. Used by `sentinel init`. */
  readonly readFile?: boolean;
}

export interface LoadedConfig {
  readonly config: SentinelConfig;
  /** Absolute path of the file the configuration came from, if any. */
  readonly sourcePath: string | null;
  /** Directory that relative paths in the configuration resolve against. */
  readonly baseDirectory: string;
}

/** Walks up from `startDirectory` looking for a configuration file. */
export async function findConfigFile(startDirectory: string): Promise<string | null> {
  let current = path.resolve(startDirectory);

  for (;;) {
    const candidate = path.join(current, CONFIG_FILE_NAME);
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {
      // Not present at this level; continue upwards.
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function mergeSections(base: PartialSentinelConfig, overrides: PartialSentinelConfig): PartialSentinelConfig {
  const merged: Record<string, unknown> = { ...base };
  for (const [section, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const existing = merged[section];
    merged[section] =
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>), ...(value as Record<string, unknown>) }
        : value;
  }
  return merged;
}

/**
 * Loads, merges and validates configuration.
 *
 * @throws {SentinelConfigError} when the file is unreadable, is not valid JSON,
 *   or fails validation. The message lists every issue found.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const shouldReadFile = options.readFile ?? true;

  let sourcePath: string | null = null;
  let fileContents: PartialSentinelConfig = {};

  if (shouldReadFile) {
    if (options.configPath !== undefined) {
      sourcePath = path.resolve(cwd, options.configPath);
      try {
        await stat(sourcePath);
      } catch {
        throw new SentinelConfigError(`Configuration file not found: ${options.configPath}`, {
          remediation: `Create it with \`sentinel init\`, or omit --config to use built-in defaults.`,
        });
      }
    } else {
      sourcePath = await findConfigFile(cwd);
    }

    if (sourcePath !== null) {
      fileContents = await readConfigFile(sourcePath);
    }
  }

  const merged = mergeSections(fileContents, options.overrides ?? {});
  const result = validateConfig(merged);

  if (!result.valid) {
    const detail = result.issues.map((issue) => `  - ${issue.path || '<root>'}: ${issue.message}`).join('\n');
    throw new SentinelConfigError(
      `Configuration is not valid${sourcePath === null ? '' : ` (${path.basename(sourcePath)})`}:\n${detail}`,
      {
        remediation: 'Correct the listed values and re-run the command.',
        ...(sourcePath === null ? {} : { details: { configPath: sourcePath } }),
      },
    );
  }

  return {
    config: result.config,
    sourcePath,
    baseDirectory: sourcePath === null ? cwd : path.dirname(sourcePath),
  };
}

async function readConfigFile(absolutePath: string): Promise<PartialSentinelConfig> {
  let text: string;
  try {
    text = await readFile(absolutePath, 'utf8');
  } catch (error) {
    throw new SentinelConfigError(`Configuration file could not be read: ${path.basename(absolutePath)}`, {
      cause: error,
      remediation: 'Check the file permissions and try again.',
    });
  }

  try {
    return JSON.parse(text) as PartialSentinelConfig;
  } catch (error) {
    throw new SentinelConfigError(`Configuration file is not valid JSON: ${path.basename(absolutePath)}`, {
      cause: error,
      remediation: 'Fix the JSON syntax. Comments and trailing commas are not permitted.',
    });
  }
}

/**
 * Resolves a configured path against the configuration's base directory.
 * Absolute configured paths are returned unchanged.
 */
export function resolveConfiguredPath(loaded: LoadedConfig, configuredPath: string): string {
  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(loaded.baseDirectory, configuredPath);
}
