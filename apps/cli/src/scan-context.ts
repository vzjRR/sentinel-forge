/**
 * Shared setup for the commands that scan a server.
 *
 * `scan`, `dependencies` and `report` differ only in what they do with the
 * result, so resolving configuration, the server path and the database belongs
 * in one place rather than three.
 */

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  SentinelUserError,
  loadConfig,
  openDatabase,
  resolveConfiguredPath,
  type LoadedConfig,
  type OpenedDatabase,
} from '@sentinel-forge/core';
import { isAtLeastSeverity, type Finding, type Severity } from '@sentinel-forge/shared';
import { persistScan, scanServer, type ScanResult } from '@sentinel-forge/engine';
import type { CommandContext } from './commands/types.js';

export interface ResolvedScanContext {
  readonly loaded: LoadedConfig;
  readonly serverPath: string;
  readonly databasePath: string;
}

/**
 * Resolves the configuration and the server path a scanning command needs.
 *
 * @throws {SentinelUserError} when no server path is configured, or the
 *   configured path is not readable. Both are the operator's to fix, and both
 *   get an example command rather than just a message.
 */
export async function resolveScanContext(context: CommandContext): Promise<ResolvedScanContext> {
  const loaded = await loadConfig({
    cwd: context.cwd,
    ...(context.options.config === undefined ? {} : { configPath: context.options.config }),
  });

  const configured = context.options.server ?? loaded.config.server.path;
  if (configured === null || configured === undefined) {
    throw new SentinelUserError('No server path is configured.', {
      remediation:
        'Pass --server, or set server.path in sentinel.config.json:\n  sentinel scan --server "/path/to/fxserver"',
    });
  }

  const serverPath = path.isAbsolute(configured)
    ? configured
    : path.resolve(context.options.server === undefined ? loaded.baseDirectory : context.cwd, configured);

  try {
    await access(serverPath, constants.R_OK);
  } catch {
    throw new SentinelUserError(`Server path does not exist or is not readable: ${serverPath}`, {
      remediation:
        'Point --server at the directory containing server.cfg and the resources directory:\n  sentinel scan --server "/path/to/fxserver"',
    });
  }

  return {
    loaded,
    serverPath,
    databasePath: resolveConfiguredPath(loaded, context.options.database ?? loaded.config.database.path),
  };
}

/** Runs a scan with the resolved configuration. */
export async function runScan(
  context: CommandContext,
  resolved: ResolvedScanContext,
  command: string,
): Promise<ScanResult> {
  const { config } = resolved.loaded;

  return scanServer({
    serverPath: resolved.serverPath,
    resourceDirectories: config.server.resourceDirectories,
    maxDepth: config.scan.maxDepth,
    maxFiles: config.scan.maxFiles,
    maxFileBytes: config.scan.maxFileBytes,
    followSymlinks: config.scan.followSymlinks,
    skipDirectories: config.scan.skipDirectories,
    minimumSeverity: config.analysis.minimumSeverity,
    disabledRules: config.analysis.disabledRules,
    clock: context.clock,
    logger: context.logger,
    command,
  });
}

/**
 * Records the scan in the local database.
 *
 * A storage failure is reported but does not fail the command: the diagnosis
 * the operator asked for has already been produced, and losing it because
 * history could not be written would be the wrong trade.
 */
export function persist(context: CommandContext, resolved: ResolvedScanContext, result: ScanResult, command: string): boolean {
  let database: OpenedDatabase | undefined;
  try {
    database = openDatabase({ location: resolved.databasePath, logger: context.logger });
    persistScan(database.driver, result, command);
    return true;
  } catch (error) {
    context.logger.warn('Scan results could not be recorded in the local database.', {
      error: error instanceof Error ? error.message : String(error),
      database: resolved.databasePath,
    });
    return false;
  } finally {
    database?.close();
  }
}

/**
 * Exit code for a completed scan: 1 when a finding reaches the configured
 * failure threshold, 0 otherwise. Findings are not an error — they are the
 * product's output — so the distinction lives in the exit code, not in stderr.
 */
export function hasFailingFindings(findings: readonly Finding[], threshold: Severity): boolean {
  return findings.some((finding) => isAtLeastSeverity(finding.severity, threshold));
}
