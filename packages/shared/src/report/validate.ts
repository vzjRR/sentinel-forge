/**
 * Structural validation for the report envelope.
 *
 * Used by the report writer before serialization and by tests that assert the
 * schema contract holds. Validation is structural only — it does not judge
 * whether the analysis was correct.
 */

import { isConfidence } from '../confidence.js';
import { isSeverity } from '../severity.js';
import type { SentinelReport } from './schema.js';

export interface ReportValidationIssue {
  /** JSON pointer-ish path, e.g. `findings[3].confidence`. */
  readonly path: string;
  readonly message: string;
}

export interface ReportValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ReportValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.includes('T');
}

/**
 * Validates the required structure of a report envelope.
 *
 * @param value - Parsed report object (for example from `JSON.parse`).
 * @param expectedSchemaVersion - When supplied, the report's `schemaVersion`
 *   must match exactly; a mismatch is reported as an issue rather than thrown.
 */
export function validateReport(value: unknown, expectedSchemaVersion?: string): ReportValidationResult {
  const issues: ReportValidationIssue[] = [];
  const push = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (!isRecord(value)) {
    return { valid: false, issues: [{ path: '', message: 'Report must be an object.' }] };
  }

  if (typeof value['schemaVersion'] !== 'string' || value['schemaVersion'].length === 0) {
    push('schemaVersion', 'Missing or non-string schemaVersion.');
  } else if (expectedSchemaVersion !== undefined && value['schemaVersion'] !== expectedSchemaVersion) {
    push('schemaVersion', `Expected schema version ${expectedSchemaVersion}, received ${String(value['schemaVersion'])}.`);
  }

  if (!isIsoTimestamp(value['generatedAt'])) {
    push('generatedAt', 'Missing or invalid ISO-8601 generatedAt timestamp.');
  }

  if (!isRecord(value['metadata'])) {
    push('metadata', 'Missing metadata object.');
  } else {
    const metadata = value['metadata'];
    if (typeof metadata['productVersion'] !== 'string') push('metadata.productVersion', 'Missing productVersion.');
    if (typeof metadata['command'] !== 'string') push('metadata.command', 'Missing command.');
    if (typeof metadata['durationMs'] !== 'number' || metadata['durationMs'] < 0) {
      push('metadata.durationMs', 'durationMs must be a non-negative number.');
    }
  }

  if (!isRecord(value['server'])) {
    push('server', 'Missing server fingerprint.');
  } else if (typeof value['server']['fingerprint'] !== 'string') {
    push('server.fingerprint', 'Missing server fingerprint hash.');
  }

  if (!Array.isArray(value['resources'])) push('resources', 'resources must be an array.');
  if (!Array.isArray(value['incidents'])) push('incidents', 'incidents must be an array.');

  if (!Array.isArray(value['limitations']) || value['limitations'].length === 0) {
    push('limitations', 'limitations must be a non-empty array. Reports must always state what they do not establish.');
  }

  if (!Array.isArray(value['findings'])) {
    push('findings', 'findings must be an array.');
  } else {
    value['findings'].forEach((finding, index) => {
      const at = `findings[${index}]`;
      if (!isRecord(finding)) {
        push(at, 'Finding must be an object.');
        return;
      }
      if (typeof finding['id'] !== 'string' || finding['id'].length === 0) push(`${at}.id`, 'Missing finding id.');
      if (typeof finding['ruleId'] !== 'string' || finding['ruleId'].length === 0) push(`${at}.ruleId`, 'Missing ruleId.');
      if (!isSeverity(finding['severity'])) push(`${at}.severity`, 'Invalid severity.');
      if (!isConfidence(finding['confidence'])) push(`${at}.confidence`, 'Confidence must be a number between 0 and 1.');
      if (typeof finding['title'] !== 'string' || finding['title'].length === 0) push(`${at}.title`, 'Missing title.');
      if (typeof finding['recommendation'] !== 'string' || finding['recommendation'].length === 0) {
        push(`${at}.recommendation`, 'Missing recommendation.');
      }
      if (!Array.isArray(finding['evidence'])) {
        push(`${at}.evidence`, 'evidence must be an array.');
      } else if (finding['severity'] !== 'INFO' && finding['evidence'].length === 0) {
        push(`${at}.evidence`, 'Findings above INFO severity must carry at least one evidence record.');
      }
      if (!isIsoTimestamp(finding['timestamp'])) push(`${at}.timestamp`, 'Missing or invalid timestamp.');
    });
  }

  return { valid: issues.length === 0, issues };
}

/** Narrowing helper for consumers that want a typed report or a thrown error. */
export function assertValidReport(value: unknown, expectedSchemaVersion?: string): asserts value is SentinelReport {
  const result = validateReport(value, expectedSchemaVersion);
  if (!result.valid) {
    const detail = result.issues.map((issue) => `${issue.path || '<root>'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid Sentinel Forge report: ${detail}`);
  }
}
