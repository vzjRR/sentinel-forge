/**
 * `sentinel health` — the explainable server health score.
 *
 * The score is never shown on its own. Every point deducted names the finding
 * that caused it, and any category that could not be scored is listed with the
 * reason, so a reader can tell a clean result from an unmeasured one.
 */

import { EXIT_CODES, type CategoryHealth, type HealthScore } from '@sentinel-forge/shared';
import { formatTable, type CommandOutcome } from '../output.js';
import { hasFailingFindings, persist, resolveScanContext, runScan } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

/** A short bar so a score reads at a glance without becoming decoration. */
function bar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  return `${'#'.repeat(filled)}${'.'.repeat(Math.max(0, width - filled))}`;
}

export function renderHealth(health: HealthScore, title: string): string[] {
  const lines: string[] = [`${title}: ${String(health.score)}/100  ${bar(health.score)}`, ''];

  if (health.cap !== undefined) {
    lines.push(`Capped: ${health.cap.reason}`, '');
  }

  if (health.categories.length > 0) {
    lines.push(
      formatTable(
        health.categories.map(
          (category: CategoryHealth) =>
            [
              category.category,
              `${String(category.score).padStart(3)}/100  ${bar(category.score, 12)}  ${String(
                category.deductions.length,
              )} finding(s)`,
            ] as const,
        ),
      ),
      '',
    );
  }

  if (health.unavailable !== undefined) {
    lines.push('Not scored:');
    for (const [category, reason] of Object.entries(health.unavailable)) {
      lines.push(`  ${category.padEnd(14)} ${reason}`);
    }
    lines.push('');
  }

  lines.push('Primary reasons:');
  for (const reason of health.primaryReasons) lines.push(`  - ${reason}`);

  return lines;
}

export const healthCommand: CommandDefinition = {
  name: 'health',
  summary: 'Show the explainable server health score.',
  usage: 'health [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 2,
  details: [
    'Scores the server from the findings of a fresh scan. Every deduction names',
    'the finding that caused it, and the deductions sum to the score.',
    '',
    'A category with no analysis behind it is reported as unavailable rather',
    'than being given a default value: scoring what was never measured would',
    'claim a result that does not exist.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const resolved = await resolveScanContext(context);
    const result = await runScan(context, resolved, 'health');
    persist(context, resolved, result, 'health');

    const health = result.report.health;
    if (health === undefined) {
      // Defensive: the pipeline always scores. Reporting "unavailable" is still
      // better than printing a number that was never computed.
      return {
        exitCode: EXIT_CODES.SUCCESS,
        text: 'Health: Unavailable. No health score was produced by this scan.',
        data: { health: null },
      };
    }

    const worst = [...result.report.resources]
      .filter((entry) => entry.health !== undefined)
      .sort((a, b) => (a.health?.score ?? 100) - (b.health?.score ?? 100))
      .slice(0, 10);

    const lines = [
      `Server: ${resolved.serverPath}`,
      '',
      ...renderHealth(health, 'Health'),
      '',
      'Lowest-scoring resources:',
      worst.length === 0
        ? '  (no resources discovered)'
        : formatTable(
            worst.map(
              (entry) =>
                [
                  entry.resource.name,
                  `${String(entry.health?.score ?? 0).padStart(3)}/100  ${String(entry.findingIds.length)} finding(s)`,
                ] as const,
            ),
          ),
    ];

    return {
      exitCode: hasFailingFindings(result.report.findings, resolved.loaded.config.analysis.failOnSeverity)
        ? EXIT_CODES.FINDINGS
        : EXIT_CODES.SUCCESS,
      text: lines.join('\n'),
      data: {
        health,
        resources: result.report.resources.map((entry) => ({
          name: entry.resource.name,
          health: entry.health,
          findings: entry.findingIds.length,
        })),
      },
    };
  },
};
