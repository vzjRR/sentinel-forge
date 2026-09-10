/**
 * Report schema — versioned output contract.
 *
 * The JSON report is a public integration surface (CI pipelines, MCP clients,
 * the dashboard). It is versioned independently of the product version and
 * must never change shape silently. See docs/API.md § Report schema.
 *
 * Sections that were not produced by a given run are `undefined` rather than
 * fabricated. Consumers must treat a missing section as "not collected".
 */

import type { Finding } from '../finding.js';
import type { HealthScore } from '../health.js';
import type { DependencyEdge, ResourceDescriptor, ServerFingerprint } from '../resource.js';
import type { Severity } from '../severity.js';

export type ReportFormat = 'json' | 'markdown' | 'html';

export const REPORT_FORMATS: readonly ReportFormat[] = Object.freeze(['json', 'markdown', 'html']);

export function isReportFormat(value: unknown): value is ReportFormat {
  return typeof value === 'string' && (REPORT_FORMATS as readonly string[]).includes(value);
}

export interface ReportMetadata {
  readonly generatedAt: string;
  readonly productVersion: string;
  readonly command: string;
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number;
  readonly hostPlatform: string;
  readonly nodeVersion: string;
}

export interface ResourceReportEntry {
  readonly resource: ResourceDescriptor;
  readonly health?: HealthScore;
  readonly findingIds: readonly string[];
}

export interface DependencyReportSection {
  readonly edges: readonly DependencyEdge[];
  readonly unresolved: readonly DependencyEdge[];
  readonly cycles: readonly (readonly string[])[];
}

export interface PerformanceReportSection {
  readonly baselineId?: string;
  readonly comparedBaselineId?: string;
  readonly sampleCount: number;
  readonly regressions: readonly string[];
  /** Present only when timing data was actually collected. */
  readonly collected: boolean;
}

export interface SecurityReportSection {
  readonly findingIds: readonly string[];
  readonly bySeverity: Readonly<Record<Severity, number>>;
  /** Verbatim limitation text, always rendered next to security output. */
  readonly limitation: string;
}

export interface IntegrityReportSection {
  readonly snapshotId?: string;
  readonly comparedSnapshotId?: string;
  readonly added: readonly string[];
  readonly modified: readonly string[];
  readonly deleted: readonly string[];
}

/**
 * Event graph summary.
 *
 * Reported as data rather than as findings: an event registered in one resource
 * and triggered from another is normal architecture. What makes it useful is
 * being able to see the shape of the traffic and follow a chain across resource
 * boundaries.
 */
export interface EventReportSection {
  readonly eventCount: number;
  readonly networkEventCount: number;
  readonly broadcastEventCount: number;
  /** Events triggered somewhere but registered nowhere in the scanned server. */
  readonly triggeredButNotRegistered: readonly string[];
  /** Events registered somewhere but never triggered in the scanned server. */
  readonly registeredButNotTriggered: readonly string[];
  /** Usages whose event name was computed at runtime and could not be read. */
  readonly dynamicUsageCount: number;
  readonly events: readonly {
    readonly event: string;
    readonly network: boolean;
    readonly broadcast: boolean;
    readonly registeredBy: readonly string[];
    readonly triggeredBy: readonly string[];
  }[];
}

export interface IncidentReportEntry {
  readonly incidentId: string;
  readonly startTime: string;
  readonly endTime?: string;
  readonly severity: Severity;
  readonly affectedResources: readonly string[];
  readonly findingIds: readonly string[];
  readonly confidence: number;
  readonly summary: string;
}

/**
 * The report envelope.
 *
 * @remarks Field order in this interface is the canonical serialization order
 * used by the report writer, so diffs between two runs stay readable.
 */
export interface SentinelReport {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly metadata: ReportMetadata;
  readonly server: ServerFingerprint;
  readonly health?: HealthScore;
  readonly resources: readonly ResourceReportEntry[];
  readonly findings: readonly Finding[];
  readonly dependencies?: DependencyReportSection;
  readonly events?: EventReportSection;
  readonly performance?: PerformanceReportSection;
  readonly security?: SecurityReportSection;
  readonly integrity?: IntegrityReportSection;
  readonly incidents: readonly IncidentReportEntry[];
  /**
   * Statements about what this report does *not* establish. Always populated;
   * a report without limitations would misrepresent the analysis.
   */
  readonly limitations: readonly string[];
}

/** Limitation text that applies to every report Sentinel Forge produces. */
export const BASE_LIMITATIONS: readonly string[] = Object.freeze([
  'Findings are produced by static and recorded-evidence analysis. They indicate observations, not proven runtime behaviour.',
  'Security findings are indicators and do not guarantee malware detection. Absence of a finding is not evidence of safety.',
  'Temporal correlation between events does not establish causation.',
  'Analysis covers only the files and data supplied to this run. Code loaded at runtime from a remote source is out of scope.',
]);

export const SECURITY_SECTION_LIMITATION =
  'Security findings are indicators and do not guarantee malware detection. Each finding requires manual verification.';
