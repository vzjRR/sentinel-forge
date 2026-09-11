/**
 * The tools.
 *
 * Ten read-only tools over what Sentinel Forge has already analysed and
 * recorded. Three rules govern every one of them, and each exists because the
 * consumer is a language model rather than a person:
 *
 *   1. **Every result carries its limitations.** An assistant that receives a
 *      finding without the sentence saying what it does not establish will
 *      present it as proven. The limitations are part of the payload, not
 *      documentation about the payload.
 *   2. **Nothing is invented for a caller's convenience.** A tool asked for
 *      timing on a server with no collector says so; it does not return an
 *      empty array that reads like "no problems".
 *   3. **Results are redacted on the way out.** Secrets are already redacted
 *      before they reach the database, so this is belt and braces — but this is
 *      the surface where a leak would be copied into a conversation and a
 *      model's context, so it is worth paying for twice.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { openDatabase, redactValue, type Logger } from '@sentinel-forge/core';
import {
  compareFindings,
  countBySeverity,
  isAtLeastSeverity,
  RUNTIME_SECTION_LIMITATION,
  SECURITY_SECTION_LIMITATION,
  SEVERITIES,
  type Finding,
  type Severity,
} from '@sentinel-forge/shared';
import { signalsFromComparison, type AnalysisContext } from '@sentinel-forge/engine';
import { buildIncidents } from '@sentinel-forge/incidents';
import {
  compareBaselines,
  findBaseline,
  loadBaselineFindings,
  loadBaselineResources,
  loadSamples,
} from '@sentinel-forge/performance';
import { compareSnapshots, findSnapshot, loadEntries } from '@sentinel-forge/integrity';
import type { ToolAnnotations, ToolDefinition } from './protocol.js';

/**
 * The hints published with every tool here.
 *
 * Stated explicitly because the specification's defaults are the opposite of
 * the truth for this server: `destructiveHint` and `openWorldHint` both default
 * to `true`.
 */
const READ_ONLY: ToolAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  // Closed world: everything answered here comes from the local filesystem and
  // the local database. No tool reaches the network.
  openWorldHint: false,
});

export interface ToolContext {
  readonly analysis: AnalysisContext;
  readonly logger: Logger;
}

export interface ToolHandlerResult {
  /** The payload returned to the caller. Always carries `limitations`. */
  readonly data: Record<string, unknown>;
  /** True when the tool could not answer. Reported as a tool error, not a protocol error. */
  readonly failed?: boolean;
}

export interface McpTool {
  readonly definition: ToolDefinition;
  /**
   * Runs the tool.
   *
   * Synchronous or not: a tool that only reads the local database has no reason
   * to pretend to be asynchronous, and the caller awaits the result either way.
   */
  run(args: Record<string, unknown>, context: ToolContext): ToolHandlerResult | Promise<ToolHandlerResult>;
}

/* -------------------------------------------------------------------------- */
/* Argument reading                                                            */
/* -------------------------------------------------------------------------- */

function readString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readSeverity(args: Record<string, unknown>, name: string): Severity | undefined {
  const value = args[name];
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase();
  return (SEVERITIES as readonly string[]).includes(upper) ? (upper as Severity) : undefined;
}

function readLimit(args: Record<string, unknown>, fallback: number, maximum: number): number {
  const value = args['limit'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, maximum);
}

/* -------------------------------------------------------------------------- */
/* Shared shapes                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A finding, trimmed for a tool result.
 *
 * Evidence excerpts are kept: they are what lets an assistant explain a finding
 * rather than restate its title. They are already redacted, and they are the
 * single most useful field in the payload.
 */
function toToolFinding(finding: Finding): Record<string, unknown> {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    category: finding.category,
    severity: finding.severity,
    confidence: finding.confidence,
    title: finding.title,
    summary: finding.summary,
    recommendation: finding.recommendation,
    ...(finding.resource === undefined ? {} : { resource: finding.resource }),
    ...(finding.file === undefined ? {} : { file: finding.file }),
    ...(finding.line === undefined ? {} : { line: finding.line }),
    evidence: finding.evidence,
  };
}

function filterFindings(
  findings: readonly Finding[],
  args: Record<string, unknown>,
): Finding[] {
  const minimum = readSeverity(args, 'minimumSeverity');
  const category = readString(args, 'category')?.toUpperCase();
  const resource = readString(args, 'resource');

  return [...findings]
    .filter((finding) => minimum === undefined || isAtLeastSeverity(finding.severity, minimum))
    .filter((finding) => category === undefined || finding.category === category)
    .filter((finding) => resource === undefined || finding.resource === resource)
    .sort(compareFindings);
}

/** A schema fragment reused by the tools that filter findings. */
const FINDING_FILTERS = {
  minimumSeverity: {
    type: 'string',
    enum: [...SEVERITIES],
    description: 'Omit findings below this severity. Severity is independent of confidence.',
  },
  category: {
    type: 'string',
    enum: ['PERFORMANCE', 'SECURITY', 'DEPENDENCIES', 'CONFIGURATION', 'INTEGRITY', 'RELIABILITY'],
    description: 'Only findings in this category.',
  },
  resource: { type: 'string', description: 'Only findings in this resource.' },
  limit: { type: 'integer', minimum: 1, description: 'Maximum findings to return. Default 50.' },
} as const;

function emptyObjectSchema(description: string): Record<string, unknown> {
  return { type: 'object', properties: {}, additionalProperties: false, description };
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                       */
/* -------------------------------------------------------------------------- */

const scanTool: McpTool = {
  definition: {
    name: 'sentinel_scan',
    title: 'Scan findings',
    description:
      'Findings from a scan of the configured FiveM server, with evidence. Findings are observations produced by ' +
      'static and recorded-evidence analysis; they are not proven runtime behaviour, and the absence of a finding ' +
      'is not evidence that a server is safe.',
    inputSchema: { type: 'object', properties: { ...FINDING_FILTERS }, additionalProperties: false },
    annotations: { ...READ_ONLY, title: 'Scan findings' },
  },
  async run(args, context) {
    const { result, at } = await context.analysis.scan();
    const findings = filterFindings(result.report.findings, args);
    const limit = readLimit(args, 50, 500);

    return {
      data: {
        server: result.report.server.path,
        scannedAt: at.toISOString(),
        counts: countBySeverity(result.report.findings),
        totalFindings: result.report.findings.length,
        returnedFindings: Math.min(findings.length, limit),
        findings: findings.slice(0, limit).map(toToolFinding),
        ...(findings.length > limit
          ? { truncated: `${String(findings.length - limit)} further finding(s) matched but were not returned.` }
          : {}),
        limitations: result.report.limitations,
      },
    };
  },
};

const healthTool: McpTool = {
  definition: {
    name: 'sentinel_health',
    title: 'Health score',
    description:
      'The server health score with every deduction that produced it, any cap applied, and the categories that ' +
      'could not be scored with the reason for each. A category that was not scored is reported as unavailable; ' +
      'it is never given a value.',
    inputSchema: emptyObjectSchema('No arguments.'),
    annotations: { ...READ_ONLY, title: 'Health score' },
  },
  async run(_args, context) {
    const { result, at } = await context.analysis.scan();
    const health = result.report.health;

    if (health === undefined) {
      return {
        data: {
          server: result.report.server.path,
          scannedAt: at.toISOString(),
          health: null,
          reason: 'Health scoring did not run for this scan.',
          limitations: result.report.limitations,
        },
      };
    }

    return {
      data: {
        server: result.report.server.path,
        scannedAt: at.toISOString(),
        score: health.score,
        complete: health.complete,
        primaryReasons: health.primaryReasons,
        ...(health.cap === undefined ? {} : { cap: health.cap }),
        categories: health.categories,
        notScored: health.unavailable ?? {},
        limitations: result.report.limitations,
      },
    };
  },
};

const resourceTool: McpTool = {
  definition: {
    name: 'sentinel_resource',
    title: 'Resource detail',
    description:
      'Everything known about one resource: its declared metadata, health, findings with evidence, the ' +
      'dependencies it declares and the resources that depend on it, and the scripts that were analysed.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The resource name, as the directory is named.' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: 'Resource detail' },
  },
  async run(args, context) {
    const name = readString(args, 'name');
    if (name === undefined) {
      return { failed: true, data: { error: 'A resource name is required.', limitations: [] } };
    }

    const { result, at } = await context.analysis.scan();
    const entry = result.report.resources.find((candidate) => candidate.resource.name === name);

    if (entry === undefined) {
      // Naming the resources that do exist turns a dead end into a next step,
      // and stops an assistant inventing a name that looked close.
      return {
        failed: true,
        data: {
          error: `No resource named "${name}" was discovered in the current scan.`,
          discoveredResources: result.report.resources.map((candidate) => candidate.resource.name).sort(),
          limitations: result.report.limitations,
        },
      };
    }

    const findings = result.report.findings.filter((finding) => finding.resource === name);

    return {
      data: {
        scannedAt: at.toISOString(),
        resource: entry.resource,
        health: entry.health ?? null,
        findings: findings.sort(compareFindings).map(toToolFinding),
        dependsOn: result.graph.edges.filter((edge) => edge.from === name),
        dependedOnBy: result.graph.edges.filter((edge) => edge.to === name),
        scripts: result.scripts
          .filter((script) => script.resource === name)
          .map((script) => ({
            file: script.filePath,
            side: script.side,
            loops: script.loops.length,
            events: script.events.length,
            queries: script.queries.length,
          })),
        limitations: result.report.limitations,
      },
    };
  },
};

const dependenciesTool: McpTool = {
  definition: {
    name: 'sentinel_dependencies',
    title: 'Dependency graph',
    description:
      'The resource dependency graph: declared and discovered edges, edges that did not resolve, and cycles. ' +
      'Entries beginning with "/" such as /server:5104 are runtime constraints rather than resources and are ' +
      'excluded from the graph rather than reported as missing.',
    inputSchema: emptyObjectSchema('No arguments.'),
    annotations: { ...READ_ONLY, title: 'Dependency graph' },
  },
  async run(_args, context) {
    const { result, at } = await context.analysis.scan();
    return {
      data: {
        scannedAt: at.toISOString(),
        edges: result.graph.edges,
        unresolved: result.graph.unresolved,
        cycles: result.graph.cycles,
        limitations: result.report.limitations,
      },
    };
  },
};

const performanceTool: McpTool = {
  definition: {
    name: 'sentinel_performance',
    title: 'Performance data',
    description:
      'What was measured on the running server by the sentinel_doctor collector, and the baselines recorded. ' +
      'FiveM exposes no scripting API for per-resource CPU or tick time, so none is collected or returned — ' +
      'the measured metric is scheduler latency, attributed to the server rather than to a resource.',
    inputSchema: emptyObjectSchema('No arguments.'),
    annotations: { ...READ_ONLY, title: 'Performance data' },
  },
  async run(_args, context) {
    const { result, at } = await context.analysis.scan();
    const history = context.analysis.history();
    const runtime = result.report.performance?.runtime;

    return {
      data: {
        scannedAt: at.toISOString(),
        collectorInstalled: runtime !== undefined,
        measured:
          runtime === undefined
            ? null
            : {
                sampleCount: runtime.sampleCount,
                eventCount: runtime.eventCount,
                metrics: runtime.metrics,
                earliest: runtime.earliest ?? null,
                latest: runtime.latest ?? null,
                droppedByCollector: runtime.dropped,
              },
        notMeasuredReason:
          runtime === undefined
            ? 'The sentinel_doctor collector is not installed on this server, so nothing about the running server has been measured. This is not the same as the server performing well.'
            : null,
        imported: history.runtime ?? null,
        baselines: history.baselines,
        staticFindings: result.report.findings
          .filter((finding) => finding.category === 'PERFORMANCE')
          .map(toToolFinding),
        limitations: [
          RUNTIME_SECTION_LIMITATION,
          'Static performance findings are produced by reading code, not by measuring a running server. They are a different kind of claim from a measurement and are never merged with one.',
          ...result.report.limitations,
        ],
      },
    };
  },
};

const compareTool: McpTool = {
  definition: {
    name: 'sentinel_compare',
    title: 'Compare two baselines',
    description:
      'What changed between two recorded baselines: resource content, configuration, findings, health, and — ' +
      'where measured samples exist on both sides — timing. Correlated changes are grouped into incidents with a ' +
      'confidence. Correlation states that observations are related in time; it never states that one caused the other.',
    inputSchema: {
      type: 'object',
      properties: {
        before: { type: 'string', description: 'Label of the earlier baseline.' },
        after: { type: 'string', description: 'Label of the later baseline.' },
      },
      required: ['before', 'after'],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: 'Compare two baselines' },
  },
  run(args, context) {
    const beforeLabel = readString(args, 'before');
    const afterLabel = readString(args, 'after');

    if (beforeLabel === undefined || afterLabel === undefined) {
      return { failed: true, data: { error: 'Two baseline labels are required.', limitations: [] } };
    }

    const history = context.analysis.history();
    if (history.serverId === undefined) {
      return {
        failed: true,
        data: {
          error: 'This server has not been scanned yet, so it has no baselines.',
          remediation: 'Record one with `sentinel baseline create <label>`.',
          limitations: [],
        },
      };
    }

    const database = openDatabase({
      location: context.analysis.databasePath,
      logger: context.logger,
    });

    try {
      const serverId = history.serverId;
      const before = findBaseline(database.driver, serverId, beforeLabel);
      const after = findBaseline(database.driver, serverId, afterLabel);

      if (before === undefined || after === undefined) {
        return {
          failed: true,
          data: {
            error: `No baseline named "${before === undefined ? beforeLabel : afterLabel}" was found for this server.`,
            availableBaselines: history.baselines.map((baseline) => baseline.label),
            limitations: [],
          },
        };
      }

      const comparison = compareBaselines({
        before,
        after,
        beforeResources: loadBaselineResources(database.driver, before.id),
        afterResources: loadBaselineResources(database.driver, after.id),
        beforeFindings: loadBaselineFindings(database.driver, before.id),
        afterFindings: loadBaselineFindings(database.driver, after.id),
        beforeSamples: loadSamples(database.driver, { serverId, baselineId: before.id }),
        afterSamples: loadSamples(database.driver, { serverId, baselineId: after.id }),
        clock: { now: () => new Date(after.createdAt), monotonicMs: () => 0 },
      });

      // Incidents are built but not persisted: a tool call must not write to
      // the operator's history. `sentinel compare` is what records them.
      const incidents = buildIncidents({
        serverId,
        signals: signalsFromComparison(comparison),
        clock: { now: () => new Date(after.createdAt), monotonicMs: () => 0 },
      });

      return {
        data: {
          before: { label: before.label, capturedAt: before.createdAt, sampleCount: before.sampleCount },
          after: { label: after.label, capturedAt: after.createdAt, sampleCount: after.sampleCount },
          resourceChanges: comparison.resourceChanges.filter((change) => change.kind !== 'UNCHANGED'),
          configurationChanged: comparison.configurationChanged,
          findingChanges: comparison.findingChanges,
          healthDelta: comparison.healthDelta ?? null,
          performance: comparison.performance,
          incidents,
          limitations: [
            'Correlation states that observations are related in time. It never establishes that one caused the other.',
            'Incident confidence is capped at 0.85 for that reason.',
            'Incidents returned here were not recorded. Run `sentinel compare` to record them.',
          ],
        },
      };
    } finally {
      database.close();
    }
  },
};

const securityTool: McpTool = {
  definition: {
    name: 'sentinel_security',
    title: 'Security indicators',
    description:
      'Security indicators with evidence and confidence: embedded credentials, webhook endpoints, obfuscation, ' +
      'remote code loading, dynamic execution and unexpected file types. These are indicators requiring human ' +
      'verification, not proof that code is malicious, and the absence of a finding is not evidence of safety. ' +
      'Detected credentials are reported by location; the value is never returned.',
    inputSchema: {
      type: 'object',
      properties: { minimumSeverity: FINDING_FILTERS.minimumSeverity, limit: FINDING_FILTERS.limit },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: 'Security indicators' },
  },
  async run(args, context) {
    const { result, at } = await context.analysis.scan();
    const findings = filterFindings(result.report.findings, { ...args, category: 'SECURITY' });
    const limit = readLimit(args, 50, 500);

    return {
      data: {
        scannedAt: at.toISOString(),
        counts: result.report.security?.bySeverity ?? countBySeverity(findings),
        findings: findings.slice(0, limit).map(toToolFinding),
        limitations: [SECURITY_SECTION_LIMITATION, 'Absence of a finding is not evidence of safety.', ...result.report.limitations],
      },
    };
  },
};

const integrityTool: McpTool = {
  definition: {
    name: 'sentinel_integrity',
    title: 'Integrity snapshots',
    description:
      'File integrity snapshots, and the comparison between two of them when both labels are supplied. A file ' +
      'whose timestamp changed but whose content did not is reported as touched, separately from a real change. ' +
      'Nothing is ever quarantined, moved, modified or deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        before: { type: 'string', description: 'Label of the earlier snapshot. Omit to list snapshots.' },
        after: { type: 'string', description: 'Label of the later snapshot. Omit to list snapshots.' },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: 'Integrity snapshots' },
  },
  run(args, context) {
    const history = context.analysis.history();
    const beforeLabel = readString(args, 'before');
    const afterLabel = readString(args, 'after');

    const listing = {
      snapshots: history.snapshots,
      limitations: [
        'A snapshot records what was on disk when it was taken. It says nothing about what a file does.',
        'Comparison requires two snapshots. Take them with `sentinel integrity snapshot <label>`.',
      ],
    };

    if (beforeLabel === undefined || afterLabel === undefined) return { data: listing };

    if (history.serverId === undefined) {
      return { failed: true, data: { error: 'This server has not been scanned yet.', limitations: [] } };
    }

    const database = openDatabase({ location: context.analysis.databasePath, logger: context.logger });
    try {
      const serverId = history.serverId;
      const before = findSnapshot(database.driver, serverId, beforeLabel);
      const after = findSnapshot(database.driver, serverId, afterLabel);

      if (before === undefined || after === undefined) {
        return {
          failed: true,
          data: {
            error: `No snapshot named "${before === undefined ? beforeLabel : afterLabel}" was found.`,
            availableSnapshots: history.snapshots.map((snapshot) => snapshot.label).filter((label) => label !== undefined),
            limitations: [],
          },
        };
      }

      const comparison = compareSnapshots(
        before,
        after,
        loadEntries(database.driver, before.id),
        loadEntries(database.driver, after.id),
      );

      return {
        data: {
          before: { label: before.label, capturedAt: before.createdAt, fileCount: before.fileCount },
          after: { label: after.label, capturedAt: after.createdAt, fileCount: after.fileCount },
          added: comparison.added,
          modified: comparison.modified,
          deleted: comparison.deleted,
          touched: comparison.touched,
          unchangedCount: comparison.unchangedCount,
          identical: comparison.identical,
          limitations: [
            'A changed file is a changed file. Whether the change was legitimate is not something a hash can answer.',
            'Touched files have identical content and a new timestamp; they are reported separately so a routine copy does not bury a real change.',
          ],
        },
      };
    } finally {
      database.close();
    }
  },
};

const incidentsTool: McpTool = {
  definition: {
    name: 'sentinel_incidents',
    title: 'Incidents',
    description:
      'Incidents recorded by `sentinel compare`, with their timelines and correlation confidence, plus the ' +
      'runtime events the collector observed. An incident groups observations that happened in the same window. ' +
      'It never names a cause, and its confidence is capped at 0.85 for that reason.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, description: 'Maximum incidents to return. Default 20.' } },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: 'Incidents' },
  },
  run(args, context) {
    const history = context.analysis.history();
    const limit = readLimit(args, 20, 200);

    return {
      data: {
        incidents: history.incidents.slice(0, limit),
        runtimeEvents: history.runtimeEvents.slice(0, 100),
        ...(history.unavailableReason === undefined ? {} : { historyUnavailable: history.unavailableReason }),
        limitations: [
          'Correlation states that observations are related in time. It never establishes that one caused the other.',
          'A runtime event is an observation of what the server did. Why it did it is not visible to a script and is not inferred.',
        ],
      },
    };
  },
};

const reportTool: McpTool = {
  definition: {
    name: 'sentinel_report',
    title: 'Full report',
    description:
      'The complete report envelope in the versioned schema: server, health, resources, findings, dependencies, ' +
      'events, performance, security and limitations. This is the same document `sentinel report --format json` ' +
      'writes. Large: prefer a narrower tool when one answers the question.',
    inputSchema: emptyObjectSchema('No arguments.'),
    annotations: { ...READ_ONLY, title: 'Full report' },
  },
  async run(_args, context) {
    const { result, at } = await context.analysis.scan();
    return {
      data: {
        scannedAt: at.toISOString(),
        report: result.report,
        limitations: result.report.limitations,
      },
    };
  },
};

/** Every tool, in the order the specification lists them. */
export const TOOLS: readonly McpTool[] = Object.freeze([
  scanTool,
  healthTool,
  resourceTool,
  dependenciesTool,
  performanceTool,
  compareTool,
  securityTool,
  integrityTool,
  incidentsTool,
  reportTool,
]);

export function findTool(name: string): McpTool | undefined {
  return TOOLS.find((tool) => tool.definition.name === name);
}

/**
 * Final redaction before a payload leaves the process.
 *
 * Secrets are already redacted before they reach the database or a report, so
 * this should never change anything. It is here because this is the surface
 * where a leak would be copied into a conversation and a model's context, and
 * "should never" is not a control.
 */
export function redactResult(data: Record<string, unknown>): Record<string, unknown> {
  return redactValue(data);
}
