/**
 * Integrity comparison.
 *
 * Reports what changed between two snapshots: files added, deleted, and
 * modified — where "modified" means the content hash changed, not merely the
 * modification time, because a touched file with identical content is not a
 * change worth reporting.
 */

import { createFinding, type Clock } from '@sentinel-forge/core';
import type { Finding } from '@sentinel-forge/shared';
import type { IntegrityEntry, IntegritySnapshot } from './snapshot.js';

export type IntegrityChangeKind = 'ADDED' | 'DELETED' | 'MODIFIED' | 'TOUCHED';

export interface IntegrityChange {
  readonly kind: IntegrityChangeKind;
  readonly path: string;
  readonly resource?: string;
  readonly before?: IntegrityEntry;
  readonly after?: IntegrityEntry;
  readonly details: readonly string[];
}

export interface IntegrityComparison {
  readonly before: IntegritySnapshot;
  readonly after: IntegritySnapshot;
  readonly added: readonly IntegrityChange[];
  readonly deleted: readonly IntegrityChange[];
  readonly modified: readonly IntegrityChange[];
  /** Same content, different modification time. Reported separately, not as a change. */
  readonly touched: readonly IntegrityChange[];
  readonly unchangedCount: number;
  /** True when the two snapshots are byte-identical. */
  readonly identical: boolean;
}

export function compareSnapshots(
  before: IntegritySnapshot,
  after: IntegritySnapshot,
  beforeEntries: readonly IntegrityEntry[],
  afterEntries: readonly IntegrityEntry[],
): IntegrityComparison {
  const beforeByPath = new Map(beforeEntries.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(afterEntries.map((entry) => [entry.path, entry]));

  const added: IntegrityChange[] = [];
  const deleted: IntegrityChange[] = [];
  const modified: IntegrityChange[] = [];
  const touched: IntegrityChange[] = [];
  let unchangedCount = 0;

  for (const [path, entry] of afterByPath) {
    const previous = beforeByPath.get(path);
    if (previous === undefined) {
      added.push({
        kind: 'ADDED',
        path,
        ...(entry.resource === undefined ? {} : { resource: entry.resource }),
        after: entry,
        details: [`New file of ${String(entry.sizeBytes)} bytes.`],
      });
      continue;
    }

    if (previous.hash !== entry.hash) {
      const details = [`Content hash changed from ${previous.hash.slice(0, 12)} to ${entry.hash.slice(0, 12)}.`];
      if (previous.sizeBytes !== entry.sizeBytes) {
        details.push(`Size changed from ${String(previous.sizeBytes)} to ${String(entry.sizeBytes)} bytes.`);
      }
      modified.push({
        kind: 'MODIFIED',
        path,
        ...(entry.resource === undefined ? {} : { resource: entry.resource }),
        before: previous,
        after: entry,
        details,
      });
      continue;
    }

    if (previous.modifiedAt !== entry.modifiedAt) {
      // Identical content, different timestamp. Worth showing, but it is not a
      // change to the code and must not be reported as one.
      touched.push({
        kind: 'TOUCHED',
        path,
        ...(entry.resource === undefined ? {} : { resource: entry.resource }),
        before: previous,
        after: entry,
        details: ['Modification time changed but the content is identical.'],
      });
      continue;
    }

    unchangedCount += 1;
  }

  for (const [path, entry] of beforeByPath) {
    if (afterByPath.has(path)) continue;
    deleted.push({
      kind: 'DELETED',
      path,
      ...(entry.resource === undefined ? {} : { resource: entry.resource }),
      before: entry,
      details: ['File is present in the earlier snapshot only.'],
    });
  }

  const byPath = (a: IntegrityChange, b: IntegrityChange): number => a.path.localeCompare(b.path);

  return {
    before,
    after,
    added: added.sort(byPath),
    deleted: deleted.sort(byPath),
    modified: modified.sort(byPath),
    touched: touched.sort(byPath),
    unchangedCount,
    identical: before.snapshotHash === after.snapshotHash,
  };
}

export interface IntegrityFindingContext {
  readonly comparison: IntegrityComparison;
  readonly clock: Clock;
  /** Labels used in the finding text. */
  readonly beforeLabel: string;
  readonly afterLabel: string;
}

/**
 * INT-CHANGE-001 — one finding per resource whose files changed.
 *
 * Reported per resource rather than per file: a resource update touches dozens
 * of files, and dozens of findings for one action is noise, not information.
 * Severity is INFO because a file changing is a fact, not a defect — its value
 * is as the anchor for correlating a change with an effect.
 */
export function toIntegrityFindings(context: IntegrityFindingContext): Finding[] {
  const { comparison } = context;
  const timestamp = context.clock.now().toISOString();

  const byResource = new Map<string, IntegrityChange[]>();
  for (const change of [...comparison.added, ...comparison.deleted, ...comparison.modified]) {
    const key = change.resource ?? '(server root)';
    byResource.set(key, [...(byResource.get(key) ?? []), change]);
  }

  return [...byResource.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([resource, changes]) => {
      const added = changes.filter((change) => change.kind === 'ADDED').length;
      const deletedCount = changes.filter((change) => change.kind === 'DELETED').length;
      const modifiedCount = changes.filter((change) => change.kind === 'MODIFIED').length;

      return createFinding({
        ruleId: 'INT-CHANGE-001',
        severity: 'INFO',
        confidence: 1,
        title: 'Resource files changed since the previous snapshot',
        summary: `${resource}: ${String(added)} file(s) added, ${String(modifiedCount)} modified, ${String(
          deletedCount,
        )} deleted between "${context.beforeLabel}" and "${context.afterLabel}".`,
        recommendation:
          'Confirm the change was expected. If it was not, compare it against the resource author’s published version before running it.',
        evidence: changes.slice(0, 25).map((change) => ({
          kind: 'FILE_HASH' as const,
          description: `${change.kind}: ${change.path}. ${change.details.join(' ')}`,
          location: { file: change.path },
          metadata: {
            kind: change.kind,
            ...(change.before === undefined ? {} : { beforeHash: change.before.hash.slice(0, 16) }),
            ...(change.after === undefined ? {} : { afterHash: change.after.hash.slice(0, 16) }),
          },
        })),
        ...(resource === '(server root)' ? {} : { resource }),
        timestamp,
        discriminator: `${context.beforeLabel}->${context.afterLabel}:${resource}`,
        metadata: { added, modified: modifiedCount, deleted: deletedCount },
      });
    });
}
