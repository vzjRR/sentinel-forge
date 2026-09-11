/**
 * `sentinel security` — security indicators, grouped by severity.
 *
 * The standing limitation is printed with every run, not buried in
 * documentation: an operator reading this output needs to know what it does and
 * does not establish, at the moment they read it.
 */

import { compareFindings, confidenceLabel, EXIT_CODES, SECURITY_SECTION_LIMITATION, SEVERITIES, type Finding } from '@sentinel-forge/shared';
import { formatTable, type CommandOutcome } from '../output.js';
import { hasFailingFindings, persist, resolveScanContext, runScan } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

function renderFinding(finding: Finding): string[] {
  const location =
    finding.file === undefined ? '' : ` ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}`;

  const lines = [
    `  ${finding.ruleId.padEnd(24)} ${finding.title}`,
    `    confidence ${finding.confidence.toFixed(2)} (${confidenceLabel(finding.confidence)})${
      finding.resource === undefined ? '' : ` [${finding.resource}]`
    }${location}`,
    `    ${finding.summary}`,
  ];

  for (const evidence of finding.evidence.slice(0, 3)) {
    const where = evidence.location === undefined ? '' : ` (${evidence.location.file}${evidence.location.line === undefined ? '' : `:${String(evidence.location.line)}`})`;
    lines.push(`    evidence: ${evidence.description}${where}`);
  }

  lines.push(`    → ${finding.recommendation}`, '');
  return lines;
}

export const securityCommand: CommandDefinition = {
  name: 'security',
  summary: 'Show security indicators with evidence and confidence.',
  usage: 'security [--server <path>] [--json]',
  status: 'IMPLEMENTED',
  gate: 4,
  details: [
    'Reports embedded credentials, webhook endpoints, obfuscation indicators,',
    'remote code loading, dynamic execution and unexpected file types.',
    '',
    'Detected credentials are reported by location. The value itself is never',
    'stored, logged or displayed.',
    '',
    'Findings are indicators. They do not establish that code is malicious, and',
    'the absence of a finding is not evidence of safety.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const resolved = await resolveScanContext(context);
    const result = await runScan(context, resolved, 'security');
    persist(context, resolved, result, 'security');

    const findings = result.report.findings
      .filter((finding) => finding.category === 'SECURITY')
      .sort(compareFindings);

    const counts = findings.reduce<Record<string, number>>((accumulator, finding) => {
      accumulator[finding.severity] = (accumulator[finding.severity] ?? 0) + 1;
      return accumulator;
    }, {});

    const lines: string[] = [`Security indicators for ${resolved.serverPath}`, ''];

    if (findings.length === 0) {
      lines.push('No security indicators were detected.', '');
    } else {
      lines.push(
        formatTable(
          [...SEVERITIES]
            .reverse()
            .filter((severity) => (counts[severity] ?? 0) > 0)
            .map((severity) => [severity, String(counts[severity] ?? 0)] as const),
        ),
        '',
      );

      for (const severity of [...SEVERITIES].reverse()) {
        const group = findings.filter((finding) => finding.severity === (severity));
        if (group.length === 0) continue;
        lines.push(`${severity} (${String(group.length)})`, '');
        for (const finding of group) lines.push(...renderFinding(finding));
      }
    }

    lines.push('Limitations:', `  ${SECURITY_SECTION_LIMITATION}`, '  Absence of a finding is not evidence of safety.');

    return {
      exitCode: hasFailingFindings(findings, resolved.loaded.config.analysis.failOnSeverity)
        ? EXIT_CODES.FINDINGS
        : EXIT_CODES.SUCCESS,
      text: lines.join('\n'),
      data: {
        findings,
        bySeverity: counts,
        limitation: SECURITY_SECTION_LIMITATION,
      },
    };
  },
};
