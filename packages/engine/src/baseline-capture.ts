/**
 * Capturing a baseline from a scan.
 *
 * A baseline is taken from a scan result rather than from a separate pass, so
 * the inventory, the findings and the health score in a baseline are exactly
 * the ones the operator saw when they took it.
 */

import { hashConfiguration, hashResourceInventory, captureBaseline, type BaselineRecord, type BaselineResourceEntry } from '@sentinel-forge/performance';
import type { Clock, DatabaseDriver } from '@sentinel-forge/core';
import { deterministicId } from '@sentinel-forge/core';
import type { ScanResult } from './scan.js';

export interface CaptureFromScanInput {
  readonly driver: DatabaseDriver;
  readonly result: ScanResult;
  readonly label: string;
  readonly notes?: string;
  readonly clock: Clock;
}

/** Builds the per-resource baseline entries from a scan's file inventory. */
export function toBaselineResources(result: ScanResult): BaselineResourceEntry[] {
  return result.server.resources.map((resource) => ({
    resource: resource.name,
    path: resource.path,
    ...(resource.manifest?.version?.value === undefined ? {} : { version: resource.manifest.version.value }),
    fileCount: resource.files.length,
    totalBytes: resource.files.reduce((sum, file) => sum + file.size, 0),
    contentHash: hashResourceInventory(resource.files),
  }));
}

export function captureBaselineFromScan(input: CaptureFromScanInput): BaselineRecord {
  const { result } = input;

  return captureBaseline(input.driver, {
    id: deterministicId('bl', result.server.id, input.label),
    serverId: result.server.id,
    label: input.label,
    serverFingerprint: result.server.fingerprint.fingerprint,
    ...(result.server.configSource === undefined
      ? {}
      : { configFingerprint: hashConfiguration(result.server.configSource) }),
    resources: toBaselineResources(result),
    findings: result.allFindings,
    ...(result.report.health === undefined ? {} : { health: result.report.health }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    createdAt: input.clock.now().toISOString(),
  });
}
