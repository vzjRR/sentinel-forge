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
import { discoverServer, type DiscoveredResource, type DiscoveredServer } from './discovery/discover.js';
import { BUNDLED_SERVER_DATA_RESOURCES } from './discovery/platform-resources.js';
import { parseServerConfig, type ParsedServerConfig } from './config/server-config.js';
import { analyzeManifestStructure, analyzeMissingFiles } from './rules/manifest-rules.js';
import { analyzeServerConfig } from './rules/config-rules.js';

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
}

export interface ScanResult {
  readonly report: SentinelReport;
  readonly server: DiscoveredServer;
  readonly graph: DependencyGraph;
  readonly config?: ParsedServerConfig;
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

  const resources: ResourceReportEntry[] = server.resources.map((resource) => ({
    resource: toDescriptor(resource),
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
    'Health scoring is NOT IMPLEMENTED in this build; no score is reported.',
    'Performance, security and integrity analysis are NOT IMPLEMENTED in this build. Those sections are absent rather than empty.',
    ...server.limitations.map((limitation) => `Not analyzed: ${limitation.path} — ${limitation.reason}`),
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
    resources,
    findings: reported,
    dependencies,
    incidents: [],
    limitations,
  };

  return { report, server, graph, ...(config === undefined ? {} : { config }), allFindings: enabled, runId, durationMs };
}

/** Persists a scan result. Every write happens in one transaction. */
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
