/**
 * Configuration contract and defaults.
 *
 * Defaults are chosen so that an operator who runs Sentinel Forge without
 * configuring anything gets the safe behaviour: local-only, read-only, no
 * network, no telemetry, no AI, no automatic modification of the server.
 *
 * Every field here is consumed by code in this build. Options for capabilities
 * that do not exist yet are not invented in advance.
 */

import type { Severity } from '@sentinel-forge/shared';
import type { LogFormat, LogLevel } from '../logging/logger.js';

/** File name searched for when no explicit config path is supplied. */
export const CONFIG_FILE_NAME = 'sentinel.config.json';

/** Directory, relative to the working directory, holding local Sentinel data. */
export const DATA_DIRECTORY_NAME = '.sentinel';

export interface ServerConfig {
  /**
   * Absolute or working-directory-relative path to the FiveM server root.
   * `null` means "not configured": commands that need a server require
   * `--server` in that case, rather than guessing a location.
   */
  readonly path: string | null;
  /**
   * Directory names, relative to the server root, that contain resources.
   * FiveM servers vary here, so this stays configurable rather than assumed.
   */
  readonly resourceDirectories: readonly string[];
}

export interface DatabaseConfig {
  /** Path to the local SQLite database file. */
  readonly path: string;
}

export interface ScanConfig {
  /** Maximum bytes read from any single file. Larger files are reported as skipped. */
  readonly maxFileBytes: number;
  /** Maximum directory depth traversed below the server root. */
  readonly maxDepth: number;
  /** Maximum number of files collected in one traversal. */
  readonly maxFiles: number;
  /** Following symlinks is opt-in; see docs/SECURITY.md. */
  readonly followSymlinks: boolean;
  /** Directory names skipped during traversal. */
  readonly skipDirectories: readonly string[];
}

export interface AnalysisConfig {
  /** Findings below this severity are collected but not reported by default. */
  readonly minimumSeverity: Severity;
  /** Rule ids disabled for this server. Must exist in the rule catalog. */
  readonly disabledRules: readonly string[];
  /**
   * Findings at or above this severity make `sentinel scan` exit with code 1.
   * Used by CI integrations.
   */
  readonly failOnSeverity: Severity;
}

export interface LoggingConfig {
  readonly level: LogLevel;
  readonly format: LogFormat;
}

export interface ReportsConfig {
  /** Directory reports are written to when `--output` is not supplied. */
  readonly outputDirectory: string;
}

/**
 * Retention windows in days. `0` disables automatic expiry for that record
 * type. Enforcement is delivered with the data it governs; see
 * docs/GATE_STATUS.md for which windows are active in this build.
 */
export interface RetentionConfig {
  readonly performanceSampleDays: number;
  readonly scanRunDays: number;
  readonly incidentDays: number;
  readonly integritySnapshotDays: number;
}

/**
 * Privacy switches. All are `false` in this build and the loader rejects `true`
 * rather than accepting a setting that nothing honours.
 */
export interface PrivacyConfig {
  /** Product telemetry. Off by default, permanently opt-in. */
  readonly telemetry: boolean;
  /** Any outbound network access, including update checks. */
  readonly network: boolean;
  /** Optional local AI explanation layer (Ollama). Never required. */
  readonly ai: boolean;
}

export interface SentinelConfig {
  readonly server: ServerConfig;
  readonly database: DatabaseConfig;
  readonly scan: ScanConfig;
  readonly analysis: AnalysisConfig;
  readonly logging: LoggingConfig;
  readonly reports: ReportsConfig;
  readonly retention: RetentionConfig;
  readonly privacy: PrivacyConfig;
}

/** A configuration in which every field is optional, as read from disk. */
export type PartialSentinelConfig = {
  readonly [K in keyof SentinelConfig]?: Partial<SentinelConfig[K]>;
};

export const DEFAULT_CONFIG: SentinelConfig = Object.freeze({
  server: Object.freeze({
    path: null,
    resourceDirectories: Object.freeze(['resources']),
  }),
  database: Object.freeze({
    path: `${DATA_DIRECTORY_NAME}/sentinel.db`,
  }),
  scan: Object.freeze({
    maxFileBytes: 4 * 1024 * 1024,
    maxDepth: 24,
    maxFiles: 200_000,
    followSymlinks: false,
    skipDirectories: Object.freeze(['.git', '.svn', '.hg', 'node_modules', 'cache', '.cache', '.sentinel']),
  }),
  analysis: Object.freeze({
    minimumSeverity: 'INFO',
    disabledRules: Object.freeze([]),
    failOnSeverity: 'HIGH',
  }),
  logging: Object.freeze({
    level: 'INFO',
    format: 'pretty',
  }),
  reports: Object.freeze({
    outputDirectory: `${DATA_DIRECTORY_NAME}/reports`,
  }),
  retention: Object.freeze({
    performanceSampleDays: 30,
    scanRunDays: 90,
    incidentDays: 180,
    integritySnapshotDays: 90,
  }),
  privacy: Object.freeze({
    telemetry: false,
    network: false,
    ai: false,
  }),
});
