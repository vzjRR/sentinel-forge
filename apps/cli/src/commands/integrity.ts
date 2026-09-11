/**
 * `sentinel integrity` — file integrity snapshots and comparison.
 *
 * Integrity tracking reports what changed. It never acts on a file: nothing is
 * quarantined, moved, modified or deleted.
 */

import { openDatabase, SentinelUserError } from '@sentinel-forge/core';
import { EXIT_CODES } from '@sentinel-forge/shared';
import {
  compareSnapshots,
  createSnapshot,
  deleteSnapshot,
  findSnapshot,
  listSnapshots,
  loadEntries,
  toIntegrityFindings,
  type IntegrityEntry,
} from '@sentinel-forge/integrity';
import { classifyFile } from '@sentinel-forge/engine';
import { formatTable, type CommandOutcome } from '../output.js';
import { persist, resolveScanContext, runScan } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

const SUBCOMMANDS = ['snapshot', 'list', 'compare', 'delete'] as const;

export const integrityCommand: CommandDefinition = {
  name: 'integrity',
  summary: 'Create and compare file integrity snapshots.',
  usage: 'integrity <snapshot|list|compare|delete> [label] [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 4,
  details: [
    'snapshot <label>       Record every file with its size, hash and type.',
    'list                   List recorded snapshots.',
    'compare <a> <b>        Report files added, modified and deleted between two.',
    'delete <label>         Remove a snapshot.',
    '',
    'A file whose modification time changed but whose content did not is',
    'reported separately as touched, not as a change.',
    '',
    'Files are never quarantined, moved, modified or deleted.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const subcommand = context.positionals[0] ?? 'list';
    if (!SUBCOMMANDS.includes(subcommand as (typeof SUBCOMMANDS)[number])) {
      throw new SentinelUserError(`Unknown integrity subcommand: ${subcommand}`, {
        remediation: `Supported subcommands: ${SUBCOMMANDS.join(', ')}.`,
      });
    }

    const resolved = await resolveScanContext(context);
    const database = openDatabase({ location: resolved.databasePath, logger: context.logger });

    try {
      const serverIdOf = (): string | undefined =>
        database.driver.prepare('SELECT id FROM servers WHERE path = ?').get<{ id: string }>(resolved.serverPath)?.id;

      switch (subcommand) {
        case 'snapshot': {
          const label = context.positionals[1];
          if (label === undefined) {
            throw new SentinelUserError('A snapshot label is required.', {
              remediation: 'Name the snapshot:\n  sentinel integrity snapshot before-update',
            });
          }

          const result = await runScan(context, resolved, 'integrity');
          persist(context, resolved, result, 'integrity');

          if (findSnapshot(database.driver, result.server.id, label) !== undefined) {
            throw new SentinelUserError(`A snapshot named "${label}" already exists for this server.`, {
              remediation: `Choose another label, or remove it first:\n  sentinel integrity delete ${label}`,
            });
          }

          const entries: IntegrityEntry[] = result.server.resources.flatMap((resource) =>
            resource.files.map((file) => ({
              path: file.serverPath,
              resource: resource.name,
              sizeBytes: file.size,
              hash: file.hash,
              modifiedAt: file.modifiedAt,
              fileType: classifyFile(file.path),
            })),
          );

          const snapshot = createSnapshot(database.driver, {
            serverId: result.server.id,
            label,
            entries,
            createdAt: context.clock.now().toISOString(),
          });

          const text = [
            `Snapshot "${label}" recorded.`,
            '',
            formatTable([
              ['Files', String(snapshot.fileCount)],
              ['Total size', `${String(snapshot.totalBytes)} bytes`],
              ['Snapshot hash', snapshot.snapshotHash.slice(0, 16)],
              ['Captured', snapshot.createdAt],
            ]),
            '',
            `Compare it later with:\n  sentinel integrity snapshot after-update\n  sentinel integrity compare ${label} after-update`,
          ].join('\n');

          return { exitCode: EXIT_CODES.SUCCESS, text, data: { snapshot } };
        }

        case 'list': {
          const serverId = serverIdOf();
          const snapshots = serverId === undefined ? [] : listSnapshots(database.driver, serverId);
          const text =
            snapshots.length === 0
              ? 'No integrity snapshots have been recorded for this server.\n\nCreate one with:\n  sentinel integrity snapshot <label>'
              : [
                  `${String(snapshots.length)} snapshot(s):`,
                  '',
                  formatTable(
                    snapshots.map(
                      (snapshot) =>
                        [
                          snapshot.label ?? snapshot.id,
                          `${snapshot.createdAt}  ${String(snapshot.fileCount)} files  ${snapshot.snapshotHash.slice(0, 12)}`,
                        ] as const,
                    ),
                  ),
                ].join('\n');

          return { exitCode: EXIT_CODES.SUCCESS, text, data: { snapshots } };
        }

        case 'compare': {
          const beforeLabel = context.positionals[1];
          const afterLabel = context.positionals[2];
          if (beforeLabel === undefined || afterLabel === undefined) {
            throw new SentinelUserError('Two snapshot labels are required.', {
              remediation: 'Name both snapshots:\n  sentinel integrity compare before-update after-update',
            });
          }

          const serverId = serverIdOf();
          if (serverId === undefined) {
            throw new SentinelUserError('This server has not been scanned yet.', {
              remediation: 'Record a snapshot first:\n  sentinel integrity snapshot before-update',
            });
          }

          const before = findSnapshot(database.driver, serverId, beforeLabel);
          const after = findSnapshot(database.driver, serverId, afterLabel);
          for (const [label, snapshot] of [
            [beforeLabel, before],
            [afterLabel, after],
          ] as const) {
            if (snapshot === undefined) {
              throw new SentinelUserError(`No snapshot named "${label}" was found for this server.`, {
                remediation: 'List what exists with:\n  sentinel integrity list',
              });
            }
          }
          if (before === undefined || after === undefined) throw new SentinelUserError('Snapshot lookup failed.');

          const comparison = compareSnapshots(
            before,
            after,
            loadEntries(database.driver, before.id),
            loadEntries(database.driver, after.id),
          );
          const findings = toIntegrityFindings({ comparison, clock: context.clock, beforeLabel, afterLabel });

          const lines: string[] = [
            `Comparing "${beforeLabel}" (${before.createdAt}) with "${afterLabel}" (${after.createdAt})`,
            '',
            formatTable([
              ['Added', String(comparison.added.length)],
              ['Modified', String(comparison.modified.length)],
              ['Deleted', String(comparison.deleted.length)],
              ['Touched (same content)', String(comparison.touched.length)],
              ['Unchanged', String(comparison.unchangedCount)],
            ]),
            '',
          ];

          if (comparison.identical) {
            lines.push('The two snapshots are byte-identical.');
          } else {
            for (const [title, changes] of [
              ['Added', comparison.added],
              ['Modified', comparison.modified],
              ['Deleted', comparison.deleted],
            ] as const) {
              if (changes.length === 0) continue;
              lines.push(`${title}:`);
              for (const change of changes.slice(0, 50)) {
                lines.push(`  ${change.path}`);
                for (const detail of change.details) lines.push(`      ${detail}`);
              }
              if (changes.length > 50) lines.push(`  … and ${String(changes.length - 50)} more.`);
              lines.push('');
            }
          }

          lines.push('Files are never quarantined, moved, modified or deleted by Sentinel Forge.');

          return {
            exitCode: findings.length > 0 ? EXIT_CODES.FINDINGS : EXIT_CODES.SUCCESS,
            text: lines.join('\n'),
            data: {
              added: comparison.added,
              modified: comparison.modified,
              deleted: comparison.deleted,
              touched: comparison.touched,
              unchangedCount: comparison.unchangedCount,
              identical: comparison.identical,
              findings,
            },
          };
        }

        case 'delete': {
          const label = context.positionals[1];
          if (label === undefined) {
            throw new SentinelUserError('A snapshot label is required.', {
              remediation: 'Name the snapshot:\n  sentinel integrity delete before-update',
            });
          }
          const serverId = serverIdOf();
          const removed = serverId !== undefined && deleteSnapshot(database.driver, serverId, label);
          if (!removed) {
            throw new SentinelUserError(`No snapshot named "${label}" was found for this server.`, {
              remediation: 'List what exists with:\n  sentinel integrity list',
            });
          }
          return {
            exitCode: EXIT_CODES.SUCCESS,
            text: `Snapshot "${label}" deleted. No file on the server was changed.`,
            data: { deleted: label },
          };
        }

        default:
          throw new SentinelUserError(`Unknown integrity subcommand: ${subcommand}`);
      }
    } finally {
      database.close();
    }
  },
};
