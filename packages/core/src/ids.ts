/**
 * Identifier generation.
 *
 * Two kinds of identifier exist:
 *
 *  - Deterministic ids (findings, resources, servers) are derived from the
 *    content they describe. Re-scanning unchanged input must produce the same
 *    ids, otherwise reports cannot be diffed and findings cannot be suppressed.
 *  - Random ids (scan runs, incidents) mark a distinct occurrence in time.
 */

import { randomUUID } from 'node:crypto';
import { hashString } from './fs/hash.js';

/** Deterministic id from ordered components, prefixed for readability. */
export function deterministicId(prefix: string, ...components: readonly (string | number)[]): string {
  const digest = hashString(components.map((component) => String(component)).join(' '));
  return `${prefix}_${digest.slice(0, 16)}`;
}

export function findingId(
  ruleId: string,
  resource: string | undefined,
  file: string | undefined,
  line: number | undefined,
  discriminator = '',
): string {
  return deterministicId('fnd', ruleId, resource ?? '', file ?? '', line ?? -1, discriminator);
}

export function serverId(canonicalPath: string): string {
  return deterministicId('srv', canonicalPath);
}

export function resourceId(server: string, resourceName: string): string {
  return deterministicId('res', server, resourceName);
}

/** Random, time-distinct id for a single execution. */
export function runId(): string {
  return `run_${randomUUID()}`;
}

export function incidentId(): string {
  return `inc_${randomUUID()}`;
}
