/**
 * Security rules.
 *
 * Every finding produced here is an *indicator*. The standing limitation is
 * attached to the security section of every report and repeated in the CLI:
 *
 *   Security findings are indicators and do not guarantee malware detection.
 *   Absence of a finding is not evidence of safety.
 *
 * Two rules of wording follow, and are asserted by tests:
 *   - nothing is described as malicious, a backdoor, or an attack;
 *   - obfuscation is described as blocking review, not as intent.
 */

import { createFinding, type Clock } from '@sentinel-forge/core';
import type { Evidence, Finding } from '@sentinel-forge/shared';
import { analyzeExecution, type ExecutionAnalysis } from './execution.js';
import { analyzeObfuscation, type ObfuscationAnalysis } from './obfuscation.js';
import { findSuspiciousFiles, type FileEntry } from './files.js';
import { scanSecrets, SECRET_KIND_LABELS, WEBHOOK_KINDS, type SecretMatch } from './secrets.js';

export interface SecurityFileInput {
  /** Server-relative POSIX path. */
  readonly filePath: string;
  readonly resource: string;
  readonly content: string;
}

export interface SecurityRuleContext {
  readonly clock: Clock;
}

/** Analyses one file's text for every content-based security indicator. */
export function analyzeSecurityContent(input: SecurityFileInput, context: SecurityRuleContext): Finding[] {
  return [
    ...secretFindings(input, context, scanSecrets(input.content, { filePath: input.filePath })),
    ...obfuscationFindings(input, context, analyzeObfuscation(input.content)),
    ...executionFindings(input, context, analyzeExecution(input.content)),
  ];
}

function secretFindings(input: SecurityFileInput, context: SecurityRuleContext, matches: readonly SecretMatch[]): Finding[] {
  const timestamp = context.clock.now().toISOString();

  return matches.map((match) => {
    const isWebhook = WEBHOOK_KINDS.has(match.kind);
    const label = SECRET_KIND_LABELS[match.kind];

    // Severity reflects what disclosure would cost. A leaked webhook lets a
    // third party post to a channel; a leaked database password is worse.
    const severity = isWebhook ? 'MEDIUM' : match.kind === 'PRIVATE_KEY' || match.kind === 'URI_CREDENTIALS' ? 'HIGH' : 'HIGH';

    const evidence: Evidence[] = [
      {
        kind: 'FILE_REFERENCE',
        description: `A ${label} was detected in this file.`,
        location: { file: input.filePath, line: match.line, column: match.column },
        // Already redacted at the detector. The finding builder redacts again.
        excerpt: match.redactedExcerpt,
        metadata: { kind: match.kind, masked: match.maskedValue },
      },
    ];

    for (const reason of match.reasons) {
      evidence.push({
        kind: 'CODE_PATTERN',
        description: reason,
        location: { file: input.filePath, line: match.line },
      });
    }

    return createFinding({
      ruleId: isWebhook ? 'SEC-WEBHOOK-001' : 'SEC-SECRET-001',
      severity: match.confidence < 0.4 ? 'LOW' : severity,
      confidence: match.confidence,
      title: isWebhook ? 'Embedded webhook endpoint' : 'Embedded credential indicator',
      summary: isWebhook
        ? `A ${label} is written into ${input.resource}. Anyone who obtains this resource can post to its destination.`
        : `A ${label} is written into ${input.resource}. Anyone who obtains this resource obtains the credential.`,
      recommendation: isWebhook
        ? 'Move the endpoint into server configuration outside the resource, and rotate it if the resource has been distributed.'
        : 'Move the value into server configuration outside the resource, and rotate it if the resource has been distributed. The value itself is not recorded by Sentinel Forge.',
      evidence,
      resource: input.resource,
      file: input.filePath,
      line: match.line,
      timestamp,
      discriminator: `${match.kind}:${String(match.line)}:${String(match.column)}`,
      metadata: { kind: match.kind, redacted: true },
    });
  });
}

function obfuscationFindings(
  input: SecurityFileInput,
  context: SecurityRuleContext,
  analysis: ObfuscationAnalysis,
): Finding[] {
  if (!analysis.reportable) return [];

  const timestamp = context.clock.now().toISOString();
  const evidence: Evidence[] = analysis.indicators.map((indicator) => ({
    kind: 'MEASUREMENT' as const,
    description: indicator.description,
    ...(indicator.line === undefined ? {} : { location: { file: input.filePath, line: indicator.line } }),
    measurement: { value: indicator.value, unit: indicator.unit },
  }));

  return [
    createFinding({
      ruleId: 'SEC-OBFUSCATION-001',
      severity: 'MEDIUM',
      confidence: Math.min(0.85, 0.4 + analysis.score * 0.5),
      title: 'Obfuscation indicators present',
      summary: `${input.filePath} shows ${String(analysis.indicators.length)} indicator(s) of transformed source. Obfuscated code cannot be reviewed, so the usual safeguard of reading it does not apply here. This is not in itself evidence of wrongdoing — commercial resources are frequently obfuscated for licence protection.`,
      recommendation:
        'Obtain the resource from a source you trust, or ask its author for reviewable source. Manual review is recommended before running it on a live server.',
      evidence,
      resource: input.resource,
      file: input.filePath,
      timestamp,
      discriminator: 'obfuscation',
      metadata: { indicatorCount: analysis.indicators.length, score: analysis.score },
    }),
  ];
}

function executionFindings(
  input: SecurityFileInput,
  context: SecurityRuleContext,
  analysis: ExecutionAnalysis,
): Finding[] {
  const timestamp = context.clock.now().toISOString();
  const findings: Finding[] = [];

  for (const remote of analysis.remoteLoads) {
    const nearest = remote.loaders[0];
    if (nearest === undefined) continue;
    const loaderSummary = remote.loaders.map((loader) => `${loader.call} (line ${String(loader.line)})`).join(', ');

    findings.push(
      createFinding({
        ruleId: 'SEC-REMOTE-LOAD-001',
        severity: 'HIGH',
        // Proximity is the evidence. A loader three lines below a fetch is a
        // stronger signal than one fifty lines below it.
        confidence: remote.distance <= 10 ? 0.8 : 0.6,
        title: 'Remote code loading indicator',
        summary: `${input.resource} fetches remote content with ${remote.fetchCall} and reaches ${
          remote.loaders.length === 1 ? 'a code loader' : `${String(remote.loaders.length)} code loaders`
        } shortly afterwards (${loaderSummary}). Code obtained at runtime is not covered by any review of the files on disk, so what runs cannot be determined from this resource alone.`,
        recommendation:
          'Confirm with the resource author what is fetched and why. If the fetch supplies data rather than code, the two operations can be separated so the code path is reviewable.',
        evidence: [
          {
            kind: 'CODE_PATTERN',
            description: `Remote fetch using ${remote.fetchCall}.`,
            location: { file: input.filePath, line: remote.fetchLine },
            ...(remote.url === undefined ? {} : { excerpt: remote.url }),
          },
          ...remote.loaders.map((loader) => ({
            kind: 'CODE_PATTERN' as const,
            description: `Code loader ${loader.call} called ${String(loader.distance)} line(s) later.`,
            location: { file: input.filePath, line: loader.line },
          })),
        ],
        resource: input.resource,
        file: input.filePath,
        line: remote.fetchLine,
        timestamp,
        discriminator: `remote-load:${String(remote.fetchLine)}`,
        metadata: { fetchCall: remote.fetchCall, loaderCount: remote.loaders.length, distance: remote.distance },
      }),
    );
  }

  for (const dynamic of analysis.dynamicExecutions) {
    // Executing a literal is unremarkable; it is reviewable by definition.
    if (dynamic.literalInput) continue;

    findings.push(
      createFinding({
        ruleId: 'SEC-DYNAMIC-EXEC-001',
        severity: 'MEDIUM',
        confidence: 0.75,
        title: 'Dynamic code execution construct',
        summary: `${input.resource} calls ${dynamic.call} on a value that is not a literal. Code assembled at runtime cannot be analysed statically, and widens the impact of any input-handling defect.`,
        recommendation:
          'Confirm what reaches this call. Where the input can come from a client, treat it as untrusted and avoid executing it.',
        evidence: [
          {
            kind: 'CODE_PATTERN',
            description: `${dynamic.call} called with a non-literal argument.`,
            location: { file: input.filePath, line: dynamic.line, column: dynamic.column },
          },
        ],
        resource: input.resource,
        file: input.filePath,
        line: dynamic.line,
        timestamp,
        discriminator: `dynamic-exec:${String(dynamic.line)}:${String(dynamic.column)}`,
        metadata: { call: dynamic.call },
      }),
    );
  }

  for (const write of analysis.fileWrites) {
    if (!write.executableTarget) continue;

    findings.push(
      createFinding({
        ruleId: 'SEC-SUSPICIOUS-FILE-001',
        severity: 'HIGH',
        confidence: 0.7,
        title: 'Resource writes an executable file',
        summary: `${input.resource} calls ${write.call} with a path that ends in an executable extension. A resource writing an executable to disk is worth a deliberate look before the resource is trusted.`,
        recommendation: 'Confirm with the resource author what is written and why.',
        evidence: [
          {
            kind: 'CODE_PATTERN',
            description: `${write.call} writing to an executable path.`,
            location: { file: input.filePath, line: write.line },
            ...(write.path === undefined ? {} : { excerpt: write.path }),
          },
        ],
        resource: input.resource,
        file: input.filePath,
        line: write.line,
        timestamp,
        discriminator: `file-write:${String(write.line)}`,
        metadata: { call: write.call },
      }),
    );
  }

  return findings;
}

export interface SuspiciousFileContext {
  readonly resource: string;
  /** Server-relative path of the resource directory. */
  readonly resourcePath: string;
  readonly files: readonly FileEntry[];
  readonly clock: Clock;
}

/** SEC-SUSPICIOUS-FILE-001 for file types a resource does not normally contain. */
export function analyzeSuspiciousFiles(context: SuspiciousFileContext): Finding[] {
  const timestamp = context.clock.now().toISOString();

  return findSuspiciousFiles(context.files).map((file) =>
    createFinding({
      ruleId: 'SEC-SUSPICIOUS-FILE-001',
      severity: file.confidence >= 0.7 ? 'HIGH' : 'LOW',
      confidence: file.confidence,
      title: 'Unexpected file type in a resource directory',
      summary: `${context.resource} contains ${file.path} (${file.extension}). ${file.reason}`,
      recommendation:
        'Confirm the file belongs to the resource and came from its author. Sentinel Forge does not open or execute it, and never quarantines files.',
      evidence: [
        {
          kind: 'FILE_REFERENCE',
          description: `${file.kind} file inside a resource directory.`,
          location: { file: `${context.resourcePath}/${file.path}` },
          metadata: { extension: file.extension, sizeBytes: file.sizeBytes },
        },
      ],
      resource: context.resource,
      file: `${context.resourcePath}/${file.path}`,
      timestamp,
      discriminator: `suspicious-file:${file.path}`,
      metadata: { kind: file.kind, extension: file.extension },
    }),
  );
}
