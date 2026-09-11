/**
 * The scan pipeline.
 *
 * Discovery, analysis and reporting are separate stages with one direction of
 * flow: the pipeline produces a report object, and the caller decides whether
 * to persist it, render it, or both. That keeps `sentinel scan`, `sentinel
 * dependencies` and (later) the dashboard on one code path rather than three.
 */

import {
  resourceId as deriveResourceId,
  insertFindings,
  insertScanRun,
  replaceDependencies,
  replaceResourceFiles,
  runId as newRunId,
  systemClock,
  upsertResource,
  upsertServer,
  type Clock,
  type DatabaseDriver,
  type Logger,
} from '@sentinel-forge/core';
import {
  BASE_LIMITATIONS,
  type EventReportSection,
  type HealthCategory,
  SECURITY_SECTION_LIMITATION,
  type SecurityReportSection,
  countBySeverity,
  compareFindings,
  isAtLeastSeverity,
  PRODUCT_VERSION,
  REPORT_SCHEMA_VERSION,
  type DependencyReportSection,
  type Finding,
  type ResourceDescriptor,
  type ResourceReportEntry,
  type SentinelReport,
  type Severity,
} from '@sentinel-forge/shared';
import {
  analyzeDependencies,
  buildDependencyGraph,
  type DependencyGraph,
  type GraphResourceInput,
} from '@sentinel-forge/dependencies';
import path from 'node:path';
import {
  analyzeManifestStructure,
  analyzeMissingFiles,
  analyzeServerConfig,
  BUNDLED_SERVER_DATA_RESOURCES,
  discoverServer,
  matchGlob,
  parseServerConfig,
  type DiscoveredResource,
  type DiscoveredServer,
  type ParsedServerConfig,
} from '@sentinel-forge/scanner';
import {
  analyzePerformance,
  analyzeScript,
  buildEventGraph,
  computeHealth,
  computeResourceHealth,
  type EventGraph,
  type ScriptAnalysis,
  type ScriptSide,
} from '@sentinel-forge/analyzer';
import { readTextFileBounded } from '@sentinel-forge/core';
import { analyzeSecurityContent, analyzeSuspiciousFiles } from '@sentinel-forge/security';

export interface ScanOptions {
  readonly serverPath: string;
  readonly resourceDirectories: readonly string[];
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly followSymlinks?: boolean;
  readonly skipDirectories?: readonly string[];
  /** Findings below this severity are omitted from the report. */
  readonly minimumSeverity: Severity;
  /** Rule ids the operator disabled. */
  readonly disabledRules: readonly string[];
  readonly clock?: Clock;
  readonly logger?: Logger;
  /** Command name recorded with the scan, e.g. `scan` or `dependencies`. */
  readonly command: string;
  /**
   * When false, security indicators are not analysed. Discovery, manifest and
   * script analysis still run.
   */
  readonly analyzeSecurity?: boolean;
  /**
   * When false, resource scripts are not read or analysed. Discovery and
   * manifest analysis still run. Used by `dependencies`, which does not need
   * script contents and should not pay for reading them.
   */
  readonly analyzeScripts?: boolean;
}

export interface ScanResult {
  readonly report: SentinelReport;
  readonly server: DiscoveredServer;
  readonly graph: DependencyGraph;
  readonly config?: ParsedServerConfig;
  readonly eventGraph: EventGraph;
  readonly scripts: readonly ScriptAnalysis[];
  /** Findings before the minimum-severity filter, for storage and counting. */
  readonly allFindings: readonly Finding[];
  readonly runId: string;
  readonly durationMs: number;
}

/** Coarse file classification used for storage and reporting. */
export function classifyFile(filePath: string): string {
  const extension = path.posix.extname(filePath).toLowerCase();
  switch (extension) {
    case '.lua':
      return 'lua';
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.ts':
      return 'javascript';
    case '.json':
      return 'json';
    case '.cfg':
    case '.ini':
    case '.toml':
    case '.yml':
    case '.yaml':
      return 'config';
    case '.html':
    case '.css':
      return 'web';
    case '.dll':
    case '.exe':
    case '.so':
    case '.dylib':
      return 'binary';
    case '':
      return 'unknown';
    default:
      return extension.slice(1);
  }
}

function toGraphInput(resource: DiscoveredResource): GraphResourceInput {
  const manifest = resource.manifest;
  const referenced = new Map<string, number>();

  for (const script of manifest?.scripts ?? []) {
    if (script.externalResource !== undefined && !referenced.has(script.externalResource)) {
      referenced.set(script.externalResource, script.line);
    }
  }
  for (const file of manifest?.files ?? []) {
    if (file.externalResource !== undefined && !referenced.has(file.externalResource)) {
      referenced.set(file.externalResource, file.line);
    }
  }

  return {
    name: resource.name,
    ...(resource.manifestPath === undefined ? {} : { manifestPath: `${resource.path}/${resource.manifestPath}` }),
    declaredDependencies: (manifest?.dependencies ?? []).map((dependency) => ({
      name: dependency.name,
      line: dependency.line,
      isRuntimeConstraint: dependency.isRuntimeConstraint,
    })),
    referencedResources: [...referenced.entries()].map(([name, line]) => ({ name, line })),
    provides: (manifest?.provides ?? []).map((entry) => entry.value),
  };
}

function toDescriptor(resource: DiscoveredResource): ResourceDescriptor {
  const version = resource.manifest?.version?.value;
  return {
    name: resource.name,
    path: resource.path,
    manifestKind: resource.manifestKind,
    // A version is reported only when the manifest declares one. It is never
    // inferred from a directory name or a file.
    ...(version === undefined ? {} : { version }),
    declaredDependencies: (resource.manifest?.dependencies ?? [])
      .filter((dependency) => !dependency.isRuntimeConstraint)
      .map((dependency) => dependency.name),
    fileCount: resource.files.length,
  };
}


/** Health categories this build can actually score, with reasons for the rest. */
export const SCORED_CATEGORIES: readonly HealthCategory[] = Object.freeze([
  'PERFORMANCE',
  'DEPENDENCIES',
  'CONFIGURATION',
]);

export const UNSCORED_CATEGORY_REASONS: Readonly<Partial<Record<HealthCategory, string>>> = Object.freeze({
  SECURITY: 'Security analysis is NOT IMPLEMENTED in this build (GATE 4).',
  INTEGRITY: 'Integrity tracking is NOT IMPLEMENTED in this build (GATE 4).',
  RELIABILITY: 'Runtime error data is NOT IMPLEMENTED in this build (GATE 5).',
});

/**
 * Which side of the client/server split a file runs on, taken from the manifest
 * declarations that reference it. A file matched by no declaration is analysed
 * anyway — it may be loaded by another file — but its side is unknown.
 */
function resolveScriptSides(resource: DiscoveredResource): Map<string, ScriptSide> {
  const sides = new Map<string, ScriptSide>();
  const available = resource.files.map((file) => file.path);

  for (const script of resource.manifest?.scripts ?? []) {
    if (script.externalResource !== undefined) continue;
    for (const match of matchGlob(script.pattern, available)) {
      const existing = sides.get(match);
      // A file declared on both sides is shared in practice.
      sides.set(match, existing === undefined || existing === script.kind ? script.kind : 'shared');
    }
  }

  return sides;
}

const ANALYZABLE_EXTENSIONS = new Set(['.lua']);

/** Reads and analyses every Lua file in a resource. */
async function analyzeResourceScripts(
  serverRoot: string,
  resource: DiscoveredResource,
  options: ScanOptions,
  limitations: { path: string; reason: string }[],
): Promise<ScriptAnalysis[]> {
  const sides = resolveScriptSides(resource);
  const analyses: ScriptAnalysis[] = [];

  for (const file of resource.files) {
    if (!ANALYZABLE_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase())) continue;
    // The manifest is analysed by the scanner; re-reading it as a script would
    // report the same declarations twice.
    if (file.path === 'fxmanifest.lua' || file.path === '__resource.lua') continue;

    let source: string;
    try {
      const read = await readTextFileBounded(path.join(serverRoot, ...file.serverPath.split('/')), {
        root: serverRoot,
        ...(options.maxFileBytes === undefined ? {} : { maxBytes: options.maxFileBytes }),
        truncate: true,
      });
      if (read.truncated) {
        limitations.push({
          path: file.serverPath,
          reason: `File exceeds the configured read limit; only the first ${String(read.bytesRead)} bytes were analysed.`,
        });
      }
      source = read.content;
    } catch (error) {
      limitations.push({
        path: file.serverPath,
        reason: `Script could not be read: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
      continue;
    }

    const analysis = analyzeScript(source, {
      filePath: file.serverPath,
      resource: resource.name,
      side: sides.get(file.path) ?? 'unknown',
    });

    if (analysis.truncated) {
      limitations.push({
        path: file.serverPath,
        reason: 'Script exceeded the analysis token budget; the remainder was not analysed.',
      });
    }

    analyses.push(analysis);
  }

  return analyses;
}

export async function scanServer(options: ScanOptions): Promise<ScanResult> {
  const clock = options.clock ?? systemClock;
  const startedAtMs = clock.monotonicMs();
  const startedAt = clock.now();
  const runId = newRunId();
  const disabled = new Set(options.disabledRules);

  const server = await discoverServer(options.serverPath, {
    resourceDirectories: options.resourceDirectories,
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
    ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
    ...(options.followSymlinks === undefined ? {} : { followSymlinks: options.followSymlinks }),
    ...(options.skipDirectories === undefined ? {} : { skipDirectories: options.skipDirectories }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    scannedAt: startedAt,
  });

  const findings: Finding[] = [];

  for (const resource of server.resources) {
    findings.push(...analyzeManifestStructure({ resource, clock }));
    findings.push(...analyzeMissingFiles({ resource, clock }));
  }

  const scripts: ScriptAnalysis[] = [];
  const scriptLimitations: { path: string; reason: string }[] = [];

  if (options.analyzeScripts !== false) {
    for (const resource of server.resources) {
      const analyses = await analyzeResourceScripts(server.root, resource, options, scriptLimitations);
      scripts.push(...analyses);
      for (const analysis of analyses) {
        findings.push(...analyzePerformance({ script: analysis, clock }));
      }

      if (options.analyzeSecurity !== false) {
        findings.push(
          ...(await analyzeResourceSecurity(server.root, resource, options, scriptLimitations, clock)),
        );
      }
    }
  }

  const eventGraph = buildEventGraph(scripts);
  const graph = buildDependencyGraph(server.resources.map(toGraphInput));
  const manifestPaths = new Map<string, string>(
    server.resources
      .filter((resource) => resource.manifestPath !== undefined)
      .map((resource) => [resource.name, `${resource.path}/${resource.manifestPath ?? ''}`]),
  );

  findings.push(
    ...analyzeDependencies({
      graph,
      platformResources: BUNDLED_SERVER_DATA_RESOURCES,
      manifestPaths,
      clock,
    }),
  );

  let config: ParsedServerConfig | undefined;
  if (server.configSource !== undefined && server.configPath !== undefined) {
    config = parseServerConfig(server.configSource);
    findings.push(
      ...analyzeServerConfig({
        config,
        configPath: server.configPath,
        discoveredResources: new Set(server.resources.map((resource) => resource.name)),
        providedNames: new Set(graph.providers.keys()),
        clock,
      }),
    );
  }

  const enabled = findings.filter((finding) => !disabled.has(finding.ruleId));
  enabled.sort(compareFindings);

  const reported = enabled.filter((finding) => isAtLeastSeverity(finding.severity, options.minimumSeverity));
  const durationMs = Math.max(0, clock.monotonicMs() - startedAtMs);

  const findingsByResource = new Map<string, string[]>();
  for (const finding of reported) {
    if (finding.resource === undefined) continue;
    const list = findingsByResource.get(finding.resource) ?? [];
    list.push(finding.id);
    findingsByResource.set(finding.resource, list);
  }

  const securityAnalyzed = options.analyzeScripts !== false && options.analyzeSecurity !== false;
  const scoredCategories = options.analyzeScripts === false
    ? SCORED_CATEGORIES.filter((category) => category !== 'PERFORMANCE')
    : SCORED_CATEGORIES;

  const unscoredReasons: Partial<Record<HealthCategory, string>> = {
    ...UNSCORED_CATEGORY_REASONS,
    ...(options.analyzeScripts === false
      ? { PERFORMANCE: 'Script analysis was not requested for this command.' }
      : {}),
    ...(securityAnalyzed ? {} : { SECURITY: 'Security analysis was not requested for this command.' }),
  };

  const categoriesWithSecurity = securityAnalyzed ? [...scoredCategories, 'SECURITY' as HealthCategory] : scoredCategories;

  const health = computeHealth({
    findings: reported,
    availableCategories: categoriesWithSecurity,
    unavailableReasons: unscoredReasons,
  });

  const resources: ResourceReportEntry[] = server.resources.map((resource) => ({
    resource: toDescriptor(resource),
    health: computeResourceHealth(resource.name, reported, categoriesWithSecurity, unscoredReasons),
    findingIds: findingsByResource.get(resource.name) ?? [],
  }));

  const dependencies: DependencyReportSection = {
    edges: graph.edges.map(({ from, to, kind, resolved, declaredIn }) => ({
      from,
      to,
      kind,
      resolved,
      ...(declaredIn === undefined ? {} : { declaredIn }),
    })),
    unresolved: graph.unresolved.map(({ from, to, kind, resolved, declaredIn }) => ({
      from,
      to,
      kind,
      resolved,
      ...(declaredIn === undefined ? {} : { declaredIn }),
    })),
    cycles: graph.cycles,
  };

  const limitations = [
    ...BASE_LIMITATIONS,
    'Performance analysis is static: it reads code, and does not measure a running server. Runtime timing arrives in GATE 3.',
    ...(securityAnalyzed
      ? [SECURITY_SECTION_LIMITATION]
      : ['Security analysis was not run for this command; the security section is absent rather than empty.']),
    'Integrity comparison requires two snapshots. Use `sentinel integrity snapshot` and `sentinel integrity compare`.',
    ...server.limitations.map((limitation) => `Not analyzed: ${limitation.path} — ${limitation.reason}`),
    ...scriptLimitations.map((limitation) => `Not fully analyzed: ${limitation.path} — ${limitation.reason}`),
  ];

  const report: SentinelReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: startedAt.toISOString(),
    metadata: {
      generatedAt: startedAt.toISOString(),
      productVersion: PRODUCT_VERSION,
      command: options.command,
      durationMs,
      hostPlatform: `${process.platform}-${process.arch}`,
      nodeVersion: process.version,
    },
    server: server.fingerprint,
    health,
    resources,
    findings: reported,
    dependencies,
    events: toEventSection(eventGraph),
    ...(securityAnalyzed ? { security: toSecuritySection(reported) } : {}),
    incidents: [],
    limitations,
  };

  return {
    report,
    server,
    graph,
    ...(config === undefined ? {} : { config }),
    eventGraph,
    scripts,
    allFindings: enabled,
    runId,
    durationMs,
  };
}

/** Persists a scan result. Every write happens in one transaction. */
/** Report view of the security findings, always carrying the standing limitation. */
function toSecuritySection(findings: readonly Finding[]): SecurityReportSection {
  const security = findings.filter((finding) => finding.category === 'SECURITY');
  return {
    findingIds: security.map((finding) => finding.id),
    bySeverity: countBySeverity(security),
    limitation: SECURITY_SECTION_LIMITATION,
  };
}

/** Runs the content-based and file-based security rules over one resource. */
async function analyzeResourceSecurity(
  serverRoot: string,
  resource: DiscoveredResource,
  options: ScanOptions,
  limitations: { path: string; reason: string }[],
  clock: Clock,
): Promise<Finding[]> {
  const findings: Finding[] = [
    ...analyzeSuspiciousFiles({
      resource: resource.name,
      resourcePath: resource.path,
      files: resource.files.map((file) => ({ path: file.path, size: file.size })),
      clock,
    }),
  ];

  for (const file of resource.files) {
    const extension = path.posix.extname(file.path).toLowerCase();
    // Text formats only: a binary is reported by its type, never opened and
    // pattern-matched, which would waste the scan and produce noise.
    if (!SECURITY_SCANNED_EXTENSIONS.has(extension)) continue;

    try {
      const read = await readTextFileBounded(path.join(serverRoot, ...file.serverPath.split('/')), {
        root: serverRoot,
        ...(options.maxFileBytes === undefined ? {} : { maxBytes: options.maxFileBytes }),
        truncate: true,
      });
      findings.push(
        ...analyzeSecurityContent(
          { filePath: file.serverPath, resource: resource.name, content: read.content },
          { clock },
        ),
      );
    } catch (error) {
      limitations.push({
        path: file.serverPath,
        reason: `Not scanned for security indicators: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
    }
  }

  return findings;
}

/** File types whose text is scanned for security indicators. */
const SECURITY_SCANNED_EXTENSIONS = new Set([
  '.lua',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.json',
  '.cfg',
  '.env',
  '.ini',
  '.yml',
  '.yaml',
  '.html',
  '.txt',
  '.md',
]);

/** Report view of the event graph: counts and cross-resource relationships. */
function toEventSection(graph: EventGraph): EventReportSection {
  return {
    eventCount: graph.events.length,
    networkEventCount: graph.events.filter((event) => event.network).length,
    broadcastEventCount: graph.events.filter((event) => event.broadcast).length,
    triggeredButNotRegistered: graph.triggeredButNotRegistered,
    registeredButNotTriggered: graph.registeredButNotTriggered,
    dynamicUsageCount: graph.dynamicUsageCount,
    events: graph.events.map((event) => ({
      event: event.event,
      network: event.network,
      broadcast: event.broadcast,
      registeredBy: [...new Set(event.registrations.map((entry) => entry.resource))].sort(),
      triggeredBy: [...new Set(event.triggers.map((entry) => entry.resource))].sort(),
    })),
  };
}

export function persistScan(driver: DatabaseDriver, result: ScanResult, command: string): void {
  const now = result.report.generatedAt;
  const serverId = result.server.id;

  driver.transaction(() => {
    upsertServer(driver, result.server.fingerprint, now);

    insertScanRun(driver, {
      id: result.runId,
      serverId,
      command,
      productVersion: PRODUCT_VERSION,
      startedAt: now,
      finishedAt: new Date(new Date(now).getTime() + result.durationMs).toISOString(),
      status: 'COMPLETED',
      durationMs: result.durationMs,
      resourceCount: result.server.resources.length,
      findingCount: result.allFindings.length,
      ...(result.server.limitations.length === 0
        ? {}
        : { incompleteReason: `${String(result.server.limitations.length)} path(s) were not analyzed.` }),
    });

    for (const resource of result.server.resources) {
      const id = deriveResourceId(serverId, resource.name);
      const version = resource.manifest?.version?.value;
      upsertResource(
        driver,
        {
          id,
          serverId,
          name: resource.name,
          path: resource.path,
          manifestKind: resource.manifestKind,
          ...(version === undefined ? {} : { version }),
          fileCount: resource.files.length,
        },
        now,
      );

      replaceResourceFiles(
        driver,
        id,
        resource.files.map((file) => ({
          resourceId: id,
          path: file.path,
          size: file.size,
          hash: file.hash,
          modifiedAt: file.modifiedAt,
          fileType: classifyFile(file.path),
        })),
        now,
      );
    }

    replaceDependencies(
      driver,
      serverId,
      result.graph.edges.map((edge) => ({
        serverId,
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        resolved: edge.resolved,
        ...(edge.declaredIn === undefined ? {} : { declaredIn: edge.declaredIn }),
      })),
      now,
    );

    insertFindings(driver, result.runId, serverId, result.allFindings);
  });
}
