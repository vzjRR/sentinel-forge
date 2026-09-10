/**
 * Markdown report rendering.
 *
 * Written for a human reading a diff in a pull request or a terminal: findings
 * are grouped by severity, every finding shows its evidence location, and the
 * limitations section is always present.
 *
 * Sections the run did not produce are stated as "not collected" rather than
 * omitted silently, so a reader can tell the difference between "measured,
 * found nothing" and "not measured".
 */

import {
  compareFindings,
  confidenceLabel,
  countBySeverity,
  formatEvidenceLocation,
  SEVERITIES,
  type Finding,
  type SentinelReport,
} from '@sentinel-forge/shared';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderFinding(finding: Finding): string {
  const lines: string[] = [
    `#### ${finding.title}`,
    '',
    `- **Rule:** \`${finding.ruleId}\``,
    `- **Severity:** ${finding.severity}`,
    `- **Confidence:** ${finding.confidence.toFixed(2)} (${confidenceLabel(finding.confidence)})`,
  ];

  if (finding.resource !== undefined) lines.push(`- **Resource:** \`${finding.resource}\``);
  if (finding.file !== undefined) {
    lines.push(`- **Location:** \`${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}\``);
  }

  lines.push('', finding.summary, '');

  if (finding.evidence.length > 0) {
    lines.push('**Evidence**', '');
    for (const evidence of finding.evidence) {
      const location = evidence.location === undefined ? '' : ` (\`${formatEvidenceLocation(evidence.location)}\`)`;
      lines.push(`- ${evidence.description}${location}`);
      if (evidence.excerpt !== undefined && evidence.excerpt.length > 0) {
        lines.push('', '  ```', ...evidence.excerpt.split('\n').map((line) => `  ${line}`), '  ```');
      }
      if (evidence.measurement !== undefined) {
        const { value, unit, sampleCount, baselineValue } = evidence.measurement;
        const samples = sampleCount === undefined ? '' : `, ${String(sampleCount)} sample(s)`;
        const baseline = baselineValue === undefined ? '' : `, baseline ${String(baselineValue)} ${unit}`;
        lines.push(`  - Measured: ${String(value)} ${unit}${baseline}${samples}`);
      }
    }
    lines.push('');
  }

  lines.push(`**Recommendation:** ${finding.recommendation}`, '');
  return lines.join('\n');
}

export function renderMarkdownReport(report: SentinelReport): string {
  const findings = [...report.findings].sort(compareFindings);
  const counts = countBySeverity(findings);
  const lines: string[] = [];

  lines.push(
    '# Sentinel Forge report',
    '',
    `Generated ${report.generatedAt} by Sentinel Forge ${report.metadata.productVersion} (\`${report.metadata.command}\`).`,
    '',
    '## Server',
    '',
    '| | |',
    '| --- | --- |',
    `| Path | \`${escapeCell(report.server.path)}\` |`,
    `| Configuration | ${report.server.configPath === undefined ? '_not found_' : `\`${escapeCell(report.server.configPath)}\``} |`,
    `| Resources | ${String(report.server.resourceCount)} |`,
    `| Fingerprint | \`${report.server.fingerprint.slice(0, 16)}\` |`,
    `| Scan duration | ${String(report.metadata.durationMs)} ms |`,
    '',
  );

  lines.push(
    '## Health',
    '',
    report.health === undefined
      ? '_Not collected._ Health scoring is NOT IMPLEMENTED in this build.'
      : `**${String(report.health.score)}/100**`,
    '',
  );

  lines.push('## Findings', '', '| Severity | Count |', '| --- | --- |');
  for (const severity of [...SEVERITIES].reverse()) {
    lines.push(`| ${severity} | ${String(counts[severity])} |`);
  }
  lines.push(`| **Total** | **${String(findings.length)}** |`, '');

  if (findings.length === 0) {
    lines.push('No findings were reported at or above the configured minimum severity.', '');
  } else {
    for (const severity of [...SEVERITIES].reverse()) {
      const group = findings.filter((finding) => finding.severity === severity);
      if (group.length === 0) continue;
      lines.push(`### ${severity} (${String(group.length)})`, '');
      for (const finding of group) lines.push(renderFinding(finding));
    }
  }

  lines.push('## Resources', '');
  if (report.resources.length === 0) {
    lines.push('No resources were discovered.', '');
  } else {
    lines.push('| Resource | Version | Files | Dependencies | Findings |', '| --- | --- | --- | --- | --- |');
    for (const entry of [...report.resources].sort((a, b) => a.resource.name.localeCompare(b.resource.name))) {
      lines.push(
        `| \`${escapeCell(entry.resource.name)}\` | ${entry.resource.version ?? '_none declared_'} | ${String(
          entry.resource.fileCount,
        )} | ${String(entry.resource.declaredDependencies.length)} | ${String(entry.findingIds.length)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Dependencies', '');
  if (report.dependencies === undefined) {
    lines.push('_Not collected._', '');
  } else {
    const { edges, unresolved, cycles } = report.dependencies;
    lines.push(
      `${String(edges.length)} edge(s), ${String(unresolved.length)} unresolved, ${String(cycles.length)} cycle(s).`,
      '',
    );
    if (unresolved.length > 0) {
      lines.push('### Unresolved', '', '| From | To | Kind |', '| --- | --- | --- |');
      for (const edge of unresolved) {
        lines.push(`| \`${escapeCell(edge.from)}\` | \`${escapeCell(edge.to)}\` | ${edge.kind} |`);
      }
      lines.push('');
    }
    if (cycles.length > 0) {
      lines.push('### Cycles', '');
      for (const cycle of cycles) {
        lines.push(`- ${[...cycle, cycle[0] ?? ''].map((name) => `\`${escapeCell(name)}\``).join(' → ')}`);
      }
      lines.push('');
    }
  }

  for (const [title, section] of [
    ['Performance', report.performance],
    ['Security', report.security],
    ['Integrity', report.integrity],
  ] as const) {
    lines.push(`## ${title}`, '', section === undefined ? '_Not collected in this build._' : '_See JSON report._', '');
  }

  lines.push('## Limitations', '');
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push('', '---', '', 'Sentinel Forge — created and developed by Talal Al Ghafri. Developer: vzjRR.', '');

  return lines.join('\n');
}
