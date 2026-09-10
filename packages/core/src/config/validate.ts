/**
 * Configuration validation.
 *
 * Hand-written rather than schema-library driven: the surface is small, the
 * messages need to be actionable for a server operator, and the foundation
 * stays dependency-free (see docs/DEVELOPMENT.md on dependency policy).
 *
 * Validation reports every problem it finds in one pass. An operator fixing a
 * config file should not have to re-run the command once per mistake.
 */

import { SEVERITIES, isKnownRuleId, isSeverity } from '@sentinel-forge/shared';
import { isLogLevel } from '../logging/logger.js';
import { DEFAULT_CONFIG, type PartialSentinelConfig, type SentinelConfig } from './schema.js';

export interface ConfigIssue {
  /** Dotted config path, e.g. `scan.maxFileBytes`. */
  readonly path: string;
  readonly message: string;
}

export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ConfigIssue[];
  /** Fully populated configuration; only meaningful when `valid` is true. */
  readonly config: SentinelConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Merges a partial configuration over the defaults and validates the result.
 *
 * @param raw - Parsed configuration object, typically from `sentinel.config.json`.
 */
export function validateConfig(raw: unknown): ConfigValidationResult {
  const issues: ConfigIssue[] = [];
  const push = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (raw !== undefined && !isRecord(raw)) {
    return {
      valid: false,
      issues: [{ path: '', message: 'Configuration must be a JSON object.' }],
      config: DEFAULT_CONFIG,
    };
  }

  const input = (raw ?? {}) as PartialSentinelConfig & Record<string, unknown>;

  const knownSections = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of Object.keys(input)) {
    // `$schema` is tolerated so editors can offer completion without complaint.
    if (!knownSections.has(key) && key !== '$schema') {
      push(key, `Unknown configuration section "${key}". Known sections: ${[...knownSections].join(', ')}.`);
    }
  }

  const server = { ...DEFAULT_CONFIG.server, ...(isRecord(input.server) ? input.server : {}) };
  if (server.path !== null && typeof server.path !== 'string') {
    push('server.path', 'server.path must be a string path or null.');
  }
  if (typeof server.path === 'string' && server.path.trim().length === 0) {
    push('server.path', 'server.path must not be empty. Use null when no server is configured.');
  }
  if (!isStringArray(server.resourceDirectories) || server.resourceDirectories.length === 0) {
    push('server.resourceDirectories', 'server.resourceDirectories must be a non-empty array of directory names.');
  }

  const database = { ...DEFAULT_CONFIG.database, ...(isRecord(input.database) ? input.database : {}) };
  if (typeof database.path !== 'string' || database.path.trim().length === 0) {
    push('database.path', 'database.path must be a non-empty string.');
  }

  const scan = { ...DEFAULT_CONFIG.scan, ...(isRecord(input.scan) ? input.scan : {}) };
  if (!Number.isInteger(scan.maxFileBytes) || scan.maxFileBytes < 1024) {
    push('scan.maxFileBytes', 'scan.maxFileBytes must be an integer of at least 1024.');
  }
  if (!Number.isInteger(scan.maxDepth) || scan.maxDepth < 1 || scan.maxDepth > 128) {
    push('scan.maxDepth', 'scan.maxDepth must be an integer between 1 and 128.');
  }
  if (!Number.isInteger(scan.maxFiles) || scan.maxFiles < 1) {
    push('scan.maxFiles', 'scan.maxFiles must be a positive integer.');
  }
  if (typeof scan.followSymlinks !== 'boolean') {
    push('scan.followSymlinks', 'scan.followSymlinks must be a boolean.');
  }
  if (!isStringArray(scan.skipDirectories)) {
    push('scan.skipDirectories', 'scan.skipDirectories must be an array of directory names.');
  }

  const analysis = { ...DEFAULT_CONFIG.analysis, ...(isRecord(input.analysis) ? input.analysis : {}) };
  if (!isSeverity(analysis.minimumSeverity)) {
    push('analysis.minimumSeverity', `analysis.minimumSeverity must be one of: ${SEVERITIES.join(', ')}.`);
  }
  if (!isSeverity(analysis.failOnSeverity)) {
    push('analysis.failOnSeverity', `analysis.failOnSeverity must be one of: ${SEVERITIES.join(', ')}.`);
  }
  if (!isStringArray(analysis.disabledRules)) {
    push('analysis.disabledRules', 'analysis.disabledRules must be an array of rule ids.');
  } else {
    for (const ruleId of analysis.disabledRules) {
      if (!isKnownRuleId(ruleId)) {
        push('analysis.disabledRules', `Unknown rule id "${ruleId}". Run \`sentinel help rules\` for the catalog.`);
      }
    }
  }

  const logging = { ...DEFAULT_CONFIG.logging, ...(isRecord(input.logging) ? input.logging : {}) };
  if (!isLogLevel(logging.level)) {
    push('logging.level', 'logging.level must be one of: DEBUG, INFO, WARN, ERROR, SILENT.');
  }
  if (logging.format !== 'pretty' && logging.format !== 'json') {
    push('logging.format', 'logging.format must be "pretty" or "json".');
  }

  const reports = { ...DEFAULT_CONFIG.reports, ...(isRecord(input.reports) ? input.reports : {}) };
  if (typeof reports.outputDirectory !== 'string' || reports.outputDirectory.trim().length === 0) {
    push('reports.outputDirectory', 'reports.outputDirectory must be a non-empty string.');
  }

  const retention = { ...DEFAULT_CONFIG.retention, ...(isRecord(input.retention) ? input.retention : {}) };
  for (const key of ['performanceSampleDays', 'scanRunDays', 'incidentDays', 'integritySnapshotDays'] as const) {
    const value = retention[key];
    if (!Number.isInteger(value) || value < 0) {
      push(`retention.${key}`, `retention.${key} must be a non-negative integer (0 disables expiry).`);
    }
  }

  const privacy = { ...DEFAULT_CONFIG.privacy, ...(isRecord(input.privacy) ? input.privacy : {}) };
  for (const key of ['telemetry', 'network', 'ai'] as const) {
    const value = privacy[key];
    if (typeof value !== 'boolean') {
      push(`privacy.${key}`, `privacy.${key} must be a boolean.`);
    } else if (value) {
      // Honest failure: no code path in this build honours these switches.
      push(
        `privacy.${key}`,
        `privacy.${key} cannot be enabled: the capability is NOT IMPLEMENTED in this build. Leave it false.`,
      );
    }
  }

  const config: SentinelConfig = {
    server,
    database,
    scan,
    analysis,
    logging,
    reports,
    retention,
    privacy,
  };

  return { valid: issues.length === 0, issues, config };
}
