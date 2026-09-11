/**
 * `sentinel baseline` — capture and inspect baselines.
 *
 * A baseline records what the server looked like at a moment: its resource
 * inventory with content hashes, its configuration fingerprint, the findings
 * that stood and the health score.
 *
 * It records performance samples only if something collected them: capturing a
 * baseline claims the samples imported since the previous one, which is what
 * makes two measurement windows comparable. On a server with no collector
 * installed, a baseline reports zero samples rather than estimating timing from
 * static analysis.
 */

import {
  captureBaselineFromScan,
  toBaselineResources,
} from '@sentinel-forge/engine';
import { deleteBaseline, findBaseline, listBaselines } from '@sentinel-forge/performance';
import { openDatabase, SentinelUserError } from '@sentinel-forge/core';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { formatTable, type CommandOutcome } from '../output.js';
import { persist, resolveScanContext, runScan } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

const SUBCOMMANDS = ['create', 'list', 'show', 'delete'] as const;

export const baselineCommand: CommandDefinition = {
  name: 'baseline',
  summary: 'Create, list and inspect performance baselines.',
  usage: 'baseline <create|list|show|delete> [label] [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 3,
  details: [
    'create <label>  Scan the server and record a baseline under that label.',
    'list            List recorded baselines, newest first.',
    'show <label>    Show one baseline in detail.',
    'delete <label>  Remove a baseline and its detail rows.',
    '',
    'A baseline records resource content hashes, the configuration fingerprint,',
    'the findings that stood and the health score. Performance samples are',
    'included only if the sentinel_doctor collector measured them and',
    '`sentinel runtime import` read them in; a baseline claims the samples',
    'collected since the previous one. Timing is never estimated.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const subcommand = context.positionals[0] ?? 'list';
    if (!SUBCOMMANDS.includes(subcommand as (typeof SUBCOMMANDS)[number])) {
      throw new SentinelUserError(`Unknown baseline subcommand: ${subcommand}`, {
        remediation: `Supported subcommands: ${SUBCOMMANDS.join(', ')}.`,
      });
    }

    const resolved = await resolveScanContext(context);
    const database = openDatabase({ location: resolved.databasePath, logger: context.logger });

    try {
      switch (subcommand) {
        case 'create': {
          const label = context.positionals[1];
          if (label === undefined) {
            throw new SentinelUserError('A baseline label is required.', {
              remediation: 'Name the baseline:\n  sentinel baseline create before-update',
            });
          }

          const result = await runScan(context, resolved, 'baseline');
          persist(context, resolved, result, 'baseline');

          if (findBaseline(database.driver, result.server.id, label) !== undefined) {
            throw new SentinelUserError(`A baseline named "${label}" already exists for this server.`, {
              remediation: `Choose another label, or remove it first:\n  sentinel baseline delete ${label}`,
            });
          }

          const record = captureBaselineFromScan({
            driver: database.driver,
            result,
            label,
            clock: context.clock,
          });

          const text = [
            `Baseline "${label}" recorded.`,
            '',
            formatTable([
              ['Resources', String(record.resourceCount)],
              ['Findings', String(record.findingCount)],
              ['Health', record.healthScore === undefined ? 'Unavailable' : `${String(record.healthScore)}/100`],
              [
                'Performance samples',
                record.sampleCount === 0
                  ? 'none collected (install sentinel_doctor, then `sentinel runtime import`)'
                  : String(record.sampleCount),
              ],
              ['Captured', record.createdAt],
            ]),
            '',
            `Compare it later with:\n  sentinel baseline create after-update\n  sentinel compare ${label} after-update`,
          ].join('\n');

          return { exitCode: EXIT_CODES.SUCCESS, text, data: { baseline: record } };
        }

        case 'list': {
          const server = database.driver
            .prepare('SELECT id FROM servers WHERE path = ?')
            .get<{ id: string }>(resolved.serverPath);

          const baselines = server === undefined ? [] : listBaselines(database.driver, server.id);
          const text =
            baselines.length === 0
              ? 'No baselines have been recorded for this server.\n\nCreate one with:\n  sentinel baseline create <label>'
              : [
                  `${String(baselines.length)} baseline(s):`,
                  '',
                  formatTable(
                    baselines.map(
                      (baseline) =>
                        [
                          baseline.label,
                          `${baseline.createdAt}  ${String(baseline.resourceCount)} resources  ${String(
                            baseline.findingCount,
                          )} findings  health ${baseline.healthScore === undefined ? 'n/a' : String(baseline.healthScore)}  ${String(
                            baseline.sampleCount,
                          )} samples`,
                        ] as const,
                    ),
                  ),
                ].join('\n');

          return { exitCode: EXIT_CODES.SUCCESS, text, data: { baselines } };
        }

        case 'show': {
          const label = context.positionals[1];
          if (label === undefined) {
            throw new SentinelUserError('A baseline label is required.', {
              remediation: 'Name the baseline:\n  sentinel baseline show before-update',
            });
          }

          const server = database.driver
            .prepare('SELECT id FROM servers WHERE path = ?')
            .get<{ id: string }>(resolved.serverPath);
          const baseline = server === undefined ? undefined : findBaseline(database.driver, server.id, label);

          if (baseline === undefined) {
            throw new SentinelUserError(`No baseline named "${label}" was found for this server.`, {
              remediation: 'List what exists with:\n  sentinel baseline list',
            });
          }

          const { loadBaselineResources, loadBaselineFindings } = await import('@sentinel-forge/performance');
          const resources = loadBaselineResources(database.driver, baseline.id);
          const findings = loadBaselineFindings(database.driver, baseline.id);

          const text = [
            `Baseline "${baseline.label}"`,
            '',
            formatTable([
              ['Captured', baseline.createdAt],
              ['Resources', String(baseline.resourceCount)],
              ['Findings', String(baseline.findingCount)],
              ['Health', baseline.healthScore === undefined ? 'Unavailable' : `${String(baseline.healthScore)}/100`],
              ['Performance samples', baseline.sampleCount === 0 ? 'none collected' : String(baseline.sampleCount)],
              ['Server fingerprint', baseline.serverFingerprint.slice(0, 16)],
              ['Config fingerprint', baseline.configFingerprint?.slice(0, 16) ?? 'not recorded'],
            ]),
            '',
            `Resources (${String(resources.length)}):`,
            formatTable(
              resources
                .slice(0, 40)
                .map((resource) => [resource.resource, `${String(resource.fileCount)} files  ${resource.contentHash.slice(0, 12)}`] as const),
            ),
          ].join('\n');

          return { exitCode: EXIT_CODES.SUCCESS, text, data: { baseline, resources, findings } };
        }

        case 'delete': {
          const label = context.positionals[1];
          if (label === undefined) {
            throw new SentinelUserError('A baseline label is required.', {
              remediation: 'Name the baseline:\n  sentinel baseline delete before-update',
            });
          }

          const server = database.driver
            .prepare('SELECT id FROM servers WHERE path = ?')
            .get<{ id: string }>(resolved.serverPath);
          const removed = server !== undefined && deleteBaseline(database.driver, server.id, label);

          if (!removed) {
            throw new SentinelUserError(`No baseline named "${label}" was found for this server.`, {
              remediation: 'List what exists with:\n  sentinel baseline list',
            });
          }

          return {
            exitCode: EXIT_CODES.SUCCESS,
            text: `Baseline "${label}" deleted. Nothing belonging to the FiveM server was changed.`,
            data: { deleted: label },
          };
        }

        default:
          throw new SentinelUserError(`Unknown baseline subcommand: ${subcommand}`);
      }
    } finally {
      database.close();
    }
  },
};

export { toBaselineResources };
