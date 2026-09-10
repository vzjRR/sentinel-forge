/**
 * `sentinel report` — write a report file.
 */

import path from 'node:path';
import { EXIT_CODES, type ReportFormat } from '@sentinel-forge/shared';
import { renderReport, writeReport } from '@sentinel-forge/reports';
import { resolveConfiguredPath } from '@sentinel-forge/core';
import { formatTable, type CommandOutcome } from '../output.js';
import { hasFailingFindings, persist, resolveScanContext, runScan } from '../scan-context.js';
import type { CommandContext, CommandDefinition } from './types.js';

export const reportCommand: CommandDefinition = {
  name: 'report',
  summary: 'Write a JSON or Markdown report.',
  usage: 'report [--format <json|markdown>] [--output <path>] [--server <path>]',
  status: 'IMPLEMENTED',
  gate: 1,
  details: [
    'Runs a scan and renders the result. With --output the report is written to',
    'that path; without it, the report is written to stdout.',
    '',
    'JSON is the canonical form and is validated against the published schema',
    'before it is written. HTML rendering is NOT IMPLEMENTED and is delivered',
    'with the dashboard in GATE 6.',
  ],
  async run(context: CommandContext): Promise<CommandOutcome> {
    const resolved = await resolveScanContext(context);
    const format: ReportFormat = context.options.format ?? 'json';

    const result = await runScan(context, resolved, 'report');
    persist(context, resolved, result, 'report');

    const failing = hasFailingFindings(result.report.findings, resolved.loaded.config.analysis.failOnSeverity);
    const exitCode = failing ? EXIT_CODES.FINDINGS : EXIT_CODES.SUCCESS;

    if (context.options.output === undefined) {
      // No destination: the report itself is the output.
      const rendered = renderReport(result.report, format);
      return { exitCode, text: rendered.trimEnd(), data: { report: result.report, format } };
    }

    const outputDirectory = resolveConfiguredPath(resolved.loaded, resolved.loaded.config.reports.outputDirectory);
    const written = await writeReport({
      report: result.report,
      format,
      outputDirectory,
      outputPath: path.resolve(context.cwd, context.options.output),
      baseName: 'sentinel-report',
    });

    const text = [
      `Report written to ${written.path}`,
      '',
      formatTable([
        ['Format', written.format],
        ['Size', `${String(written.bytes)} bytes`],
        ['Findings', String(result.report.findings.length)],
        ['Resources', String(result.report.resources.length)],
      ]),
    ].join('\n');

    return {
      exitCode,
      text,
      data: {
        path: written.path,
        format: written.format,
        bytes: written.bytes,
        findings: result.report.findings.length,
        resources: result.report.resources.length,
      },
    };
  },
};
