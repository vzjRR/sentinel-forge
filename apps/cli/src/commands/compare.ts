/**
 * `sentinel compare` — what changed between two baselines.
 *
 * This is the command the product exists for: not "CPU is high" but "these
 * resources changed, these findings appeared, and here is how the two relate".
 */

import { openDatabase, SentinelUserError } from '@sentinel-forge/core';
import { EXIT_CODES } from '@sentinel-forge/shared';
import {
  compareBaselines,
  findBaseline,
  loadBaselineFindings,
  loadBaselineResources,
  loadSamples,
} from '@sentinel-forge/performance';
import { buildIncidents, persistIncidents } from '@sentinel-forge/incidents';
import { signalsFromComparison } from '@sentinel-forge/engine';
import { formatTable, type CommandOutcome } from '../output.js';
import { resolveScanContext } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

export const compareCommand: CommandDefinition = {
  name: 'compare',
  summary: 'Compare two baselines and report what changed.',
  usage: 'compare <baseline-a> <baseline-b> [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 3,
  details: [
    'Compares resource content, configuration, findings and — where samples',
    'exist on both sides — measured performance.',
    '',
    'Correlated changes are grouped into incidents with a confidence value.',
    'Correlation states that observations are related in time. It never states',
    'that one caused the other.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const beforeLabel = context.positionals[0];
    const afterLabel = context.positionals[1];

    if (beforeLabel === undefined || afterLabel === undefined) {
      throw new SentinelUserError('Two baseline labels are required.', {
        remediation: 'Name both baselines:\n  sentinel compare before-update after-update',
      });
    }

    const resolved = await resolveScanContext(context);
    const database = openDatabase({ location: resolved.databasePath, logger: context.logger });

    try {
      const server = database.driver
        .prepare('SELECT id FROM servers WHERE path = ?')
        .get<{ id: string }>(resolved.serverPath);

      if (server === undefined) {
        throw new SentinelUserError('This server has not been scanned yet.', {
          remediation: 'Record a baseline first:\n  sentinel baseline create before-update',
        });
      }

      const before = findBaseline(database.driver, server.id, beforeLabel);
      const after = findBaseline(database.driver, server.id, afterLabel);

      for (const [label, baseline] of [
        [beforeLabel, before],
        [afterLabel, after],
      ] as const) {
        if (baseline === undefined) {
          throw new SentinelUserError(`No baseline named "${label}" was found for this server.`, {
            remediation: 'List what exists with:\n  sentinel baseline list',
          });
        }
      }
      if (before === undefined || after === undefined) throw new SentinelUserError('Baseline lookup failed.');

      const comparison = compareBaselines({
        before,
        after,
        beforeResources: loadBaselineResources(database.driver, before.id),
        afterResources: loadBaselineResources(database.driver, after.id),
        beforeFindings: loadBaselineFindings(database.driver, before.id),
        afterFindings: loadBaselineFindings(database.driver, after.id),
        beforeSamples: loadSamples(database.driver, { serverId: server.id, baselineId: before.id }),
        afterSamples: loadSamples(database.driver, { serverId: server.id, baselineId: after.id }),
        clock: context.clock,
      });

      const incidents = buildIncidents({
        serverId: server.id,
        signals: signalsFromComparison(comparison),
        clock: context.clock,
      });
      if (incidents.length > 0) persistIncidents(database.driver, incidents);

      const changed = comparison.resourceChanges.filter((change) => change.kind !== 'UNCHANGED');
      const introduced = comparison.findingChanges.filter((change) => change.kind === 'INTRODUCED');
      const resolvedFindings = comparison.findingChanges.filter((change) => change.kind === 'RESOLVED');

      const lines: string[] = [
        `Comparing "${beforeLabel}" (${before.createdAt}) with "${afterLabel}" (${after.createdAt})`,
        '',
        formatTable([
          ['Resources changed', String(changed.length)],
          ['Configuration', comparison.configurationChanged ? 'changed' : 'unchanged'],
          ['Findings introduced', String(introduced.length)],
          ['Findings resolved', String(resolvedFindings.length)],
          [
            'Health',
            comparison.healthDelta === undefined
              ? 'not comparable'
              : `${String(before.healthScore ?? 0)} -> ${String(after.healthScore ?? 0)} (${
                  comparison.healthDelta >= 0 ? '+' : ''
                }${String(comparison.healthDelta)})`,
          ],
          ['Incidents', String(incidents.length)],
        ]),
        '',
      ];

      if (changed.length > 0) {
        lines.push('Resource changes:');
        for (const change of changed) {
          lines.push(`  ${change.kind.padEnd(9)} ${change.resource}`);
          for (const detail of change.details) lines.push(`            ${detail}`);
        }
        lines.push('');
      }

      if (introduced.length > 0) {
        lines.push('Findings introduced:');
        for (const change of introduced) {
          lines.push(`  ${change.severity.padEnd(8)} ${change.ruleId.padEnd(24)} ${change.title}${change.resource === undefined ? '' : ` [${change.resource}]`}`);
        }
        lines.push('');
      }

      if (resolvedFindings.length > 0) {
        lines.push('Findings resolved:');
        for (const change of resolvedFindings) {
          lines.push(`  ${change.severity.padEnd(8)} ${change.ruleId.padEnd(24)} ${change.title}${change.resource === undefined ? '' : ` [${change.resource}]`}`);
        }
        lines.push('');
      }

      lines.push('Performance:');
      if (!comparison.performance.compared) {
        lines.push(`  Not compared. ${comparison.performance.reason ?? ''}`);
      } else {
        lines.push(
          `  ${String(comparison.performance.results.length)} metric(s) compared, ${String(
            comparison.performance.regressions.length,
          )} regression(s), ${String(comparison.performance.improvements.length)} improvement(s).`,
        );
        for (const result of comparison.performance.results) {
          lines.push(`  ${result.verdict.padEnd(26)} ${result.resource}: ${result.explanation}`);
        }
      }
      lines.push('');

      if (incidents.length > 0) {
        lines.push('Incidents:');
        for (const incident of incidents) {
          lines.push(
            `  ${incident.severity.padEnd(8)} confidence ${incident.confidence.toFixed(2)}  ${incident.startedAt}`,
            `           ${incident.summary}`,
            `           Affected: ${incident.affectedResources.join(', ') || 'server-wide'}`,
            `           → ${incident.recommendation}`,
          );
        }
      }

      return {
        exitCode: introduced.length > 0 || comparison.performance.regressions.length > 0 ? EXIT_CODES.FINDINGS : EXIT_CODES.SUCCESS,
        text: lines.join('\n').trimEnd(),
        data: {
          before,
          after,
          resourceChanges: changed,
          configurationChanged: comparison.configurationChanged,
          findingChanges: comparison.findingChanges,
          healthDelta: comparison.healthDelta ?? null,
          performance: comparison.performance,
          findings: comparison.findings,
          incidents,
        },
      };
    } finally {
      database.close();
    }
  },
};
