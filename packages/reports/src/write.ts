/**
 * Report writing.
 *
 * Output paths are contained: a report is written inside the directory the
 * caller nominated, and a `--output` value that escapes it is refused. The
 * report is rendered before the file is opened, so a rendering failure never
 * leaves a half-written report behind.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SentinelNotImplementedError, resolveWithinRoot } from '@sentinel-forge/core';
import type { ReportFormat, SentinelReport } from '@sentinel-forge/shared';
import { renderHtmlReport } from './html/report.js';
import { renderJsonReport } from './json.js';
import { renderMarkdownReport } from './markdown.js';

export const REPORT_FILE_EXTENSIONS: Readonly<Record<ReportFormat, string>> = Object.freeze({
  json: '.json',
  markdown: '.md',
  html: '.html',
});

/**
 * Renders a report in the requested format.
 *
 * @throws {SentinelNotImplementedError} for a format this build does not
 *   render. A placeholder document would misrepresent the format as delivered.
 */
export function renderReport(report: SentinelReport, format: ReportFormat): string {
  switch (format) {
    case 'json':
      return renderJsonReport(report);
    case 'markdown':
      return renderMarkdownReport(report);
    case 'html':
      return renderHtmlReport(report);
    default:
      throw new SentinelNotImplementedError(`Report format "${String(format)}"`, 6);
  }
}

export interface WriteReportOptions {
  readonly report: SentinelReport;
  readonly format: ReportFormat;
  /** Directory reports may be written into. */
  readonly outputDirectory: string;
  /** Explicit file path. Must resolve inside `outputDirectory`. */
  readonly outputPath?: string;
  /** Base file name used when no explicit path is given. */
  readonly baseName?: string;
}

export interface WrittenReport {
  readonly path: string;
  readonly format: ReportFormat;
  readonly bytes: number;
}

export async function writeReport(options: WriteReportOptions): Promise<WrittenReport> {
  const content = renderReport(options.report, options.format);

  const target =
    options.outputPath === undefined
      ? path.join(
          options.outputDirectory,
          `${options.baseName ?? 'sentinel-report'}${REPORT_FILE_EXTENSIONS[options.format]}`,
        )
      : path.resolve(options.outputPath);

  await mkdir(path.dirname(target), { recursive: true });

  // Containment is checked after the directory exists so that symlink
  // resolution has something real to resolve.
  const contained =
    options.outputPath === undefined
      ? target
      : resolveWithinRoot(path.dirname(target), target, { label: 'report output path' });

  await writeFile(contained, content, 'utf8');
  return { path: contained, format: options.format, bytes: Buffer.byteLength(content, 'utf8') };
}
