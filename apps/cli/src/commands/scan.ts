/**
 * `sentinel scan` — scan a server and report findings.
 */

import {
  compareFindings,
  confidenceLabel,
  countBySeverity,
  SEVERITIES,
  type Finding,
} from '@sentinel-forge/shared';
import { EXIT_CODES } from '@sentinel-forge/shared';
import { renderReport } from '@sentinel-forge/reports';
import { formatTable, type CommandOutcome } from '../output.js';
import { hasFailingFindings, persist, resolveScanContext, runScan } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

function renderFindingLine(finding: Finding): string {
  const location =
    finding.file === undefined ? '' : ` ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}`;
  const resource = finding.resource === undefined ? '' : ` [${finding.resource}]`;
  return [
    `  ${finding.severity.padEnd(8)} ${finding.ruleId.padEnd(24)} ${finding.title}`,
    `           confidence ${finding.confidence.toFixed(2)} (${confidenceLabel(finding.confidence)})${resource}${location}`,
    `           ${finding.summary}`,
    `           → ${finding.recommendation}`,
  ].join('\n');
}

export const scanCommand: CommandDefinition = {
  name: 'scan',
  summary: 'Scan a server and report findings.',
  usage: 'scan [--server <path>] [--json] [--format <json|markdown>]',
  status: 'IMPLEMENTED',
  gate: 1,
  details: [
    'Discovers resources, parses manifests, resolves dependencies and reports',
    'findings with evidence. Results are recorded in the local database.',
    '',
    'Nothing in the scanned server is executed or modified.',
    '',
    'Exits 1 when a finding reaches analysis.failOnSeverity (default HIGH),',
    '0 when none does.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const resolved = await resolveScanContext(context);
    context.logger.info('Scanning server.', { server: resolved.serverPath });

    const result = await runScan(context, resolved, 'scan');
    const recorded = persist(context, resolved, result, 'scan');

    // `--format` on `scan` writes the full report to stdout instead of the
    // summary, so a pipeline can capture it without a second scan.
    if (context.options.format !== undefined) {
      const rendered = renderReport(result.report, context.options.format);
      return {
        exitCode: hasFailingFindings(result.report.findings, resolved.loaded.config.analysis.failOnSeverity)
          ? EXIT_CODES.FINDINGS
          : EXIT_CODES.SUCCESS,
        text: rendered.trimEnd(),
        data: { report: result.report },
      };
    }

    const findings = [...result.report.findings].sort(compareFindings);
    const counts = countBySeverity(findings);
    const failing = hasFailingFindings(findings, resolved.loaded.config.analysis.failOnSeverity);

    const health = result.report.health;
    const lines: string[] = [
      `Scanned ${resolved.serverPath}`,
      '',
      formatTable([
        ...(health === undefined ? [] : [['Health', `${String(health.score)}/100`] as const]),
        ['Resources', String(result.server.resources.length)],
        ['Files', String(result.server.resources.reduce((total, resource) => total + resource.files.length, 0))],
        ['Dependencies', String(result.graph.edges.length)],
        ['Unresolved', String(result.graph.unresolved.length)],
        ['Cycles', String(result.graph.cycles.length)],
        ['Findings', String(findings.length)],
        ['Duration', `${String(result.durationMs)} ms`],
        ['Recorded', recorded ? 'yes' : 'no (see log)'],
      ]),
      '',
    ];

    if (findings.length === 0) {
      lines.push('No findings at or above the configured minimum severity.');
    } else {
      lines.push(
        formatTable(
          [...SEVERITIES]
            .reverse()
            .filter((severity) => counts[severity] > 0)
            .map((severity) => [severity, String(counts[severity])] as const),
        ),
        '',
      );
      for (const finding of findings) lines.push(renderFindingLine(finding), '');
    }

    if (result.server.limitations.length > 0) {
      lines.push(
        '',
        `Analysis was incomplete for ${String(result.server.limitations.length)} path(s). See the report limitations section.`,
      );
    }

    return {
      exitCode: failing ? EXIT_CODES.FINDINGS : EXIT_CODES.SUCCESS,
      text: lines.join('\n').trimEnd(),
      data: {
        server: result.report.server,
        summary: {
          resources: result.server.resources.length,
          findings: findings.length,
          bySeverity: counts,
          unresolvedDependencies: result.graph.unresolved.length,
          cycles: result.graph.cycles.length,
          durationMs: result.durationMs,
          recorded,
        },
        findings,
        limitations: result.report.limitations,
      },
    };
  },
};
