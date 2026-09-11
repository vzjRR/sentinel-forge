/**
 * Locating the collector on disk.
 *
 * A FiveM server places resources either directly under a resource directory
 * (`resources/sentinel_doctor`) or inside a category directory
 * (`resources/[local]/sentinel_doctor`). Both layouts are official, so both are
 * searched — and only those two depths, because walking an entire server to
 * find one known directory name costs the operator a second of I/O for nothing.
 *
 * Nothing here reads a file. It answers one question: where, if anywhere, is
 * the collector installed, and what has it written?
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveWithinRoot } from '@sentinel-forge/core';

/** Name of the collector resource. */
export const COLLECTOR_RESOURCE = 'sentinel_doctor';

/** Directory, relative to the collector resource, that telemetry is written to. */
export const TELEMETRY_DIRECTORY = 'telemetry';

export interface CollectorInstallation {
  /** Absolute path of the collector resource directory. */
  readonly absolutePath: string;
  /** Server-relative POSIX path of the collector resource directory. */
  readonly relativePath: string;
  /** Telemetry files found, newest name last. Empty when nothing was written. */
  readonly telemetryFiles: readonly CollectorTelemetryFile[];
  /** True when the resource exists but has written no telemetry yet. */
  readonly hasTelemetryDirectory: boolean;
}

export interface CollectorTelemetryFile {
  readonly absolutePath: string;
  /** Server-relative POSIX path, safe to place in a report. */
  readonly relativePath: string;
}

export interface LocateCollectorOptions {
  /** Absolute path of the server root. */
  readonly serverRoot: string;
  /** Resource directory names, relative to the server root. */
  readonly resourceDirectories: readonly string[];
}

async function listDirectories(absolutePath: string): Promise<string[]> {
  try {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    // Symlinked directories are not followed: the collector writes into its own
    // resource directory, and a link pointing elsewhere is not that.
    return entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name);
  } catch {
    // An unreadable or absent directory is not an error here — most servers do
    // not have the collector installed, and that is a normal answer.
    return [];
  }
}

async function listTelemetryFiles(
  serverRoot: string,
  collectorAbsolute: string,
  collectorRelative: string,
): Promise<{ files: CollectorTelemetryFile[]; present: boolean }> {
  const telemetryAbsolute = path.join(collectorAbsolute, TELEMETRY_DIRECTORY);

  let entries;
  try {
    entries = await readdir(telemetryAbsolute, { withFileTypes: true });
  } catch {
    return { files: [], present: false };
  }

  const files: CollectorTelemetryFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const absolutePath = path.join(telemetryAbsolute, entry.name);
    // Containment is enforced even though the path was assembled from a
    // directory listing: a file name is untrusted input like any other.
    resolveWithinRoot(serverRoot, absolutePath, { label: 'telemetry file' });

    files.push({
      absolutePath,
      relativePath: `${collectorRelative}/${TELEMETRY_DIRECTORY}/${entry.name}`,
    });
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, present: true };
}

/**
 * Finds every installed copy of the collector under the configured resource
 * directories.
 *
 * More than one can be found — a server can have the resource in two category
 * directories — and all of them are returned rather than the first, because a
 * duplicate installation is something the operator should be told about.
 */
export async function locateCollector(options: LocateCollectorOptions): Promise<CollectorInstallation[]> {
  const installations: CollectorInstallation[] = [];
  const seen = new Set<string>();

  for (const directory of options.resourceDirectories) {
    const resourceRootAbsolute = resolveWithinRoot(options.serverRoot, path.join(options.serverRoot, directory), {
      label: 'resource directory',
    });

    const candidates: { absolutePath: string; relativePath: string }[] = [];
    for (const name of await listDirectories(resourceRootAbsolute)) {
      const absolutePath = path.join(resourceRootAbsolute, name);
      const relativePath = `${directory}/${name}`;

      if (name === COLLECTOR_RESOURCE) {
        candidates.push({ absolutePath, relativePath });
        continue;
      }

      // One level deeper: a category directory such as `[local]`. Resources do
      // not nest further than this in a documented FiveM layout.
      for (const nested of await listDirectories(absolutePath)) {
        if (nested !== COLLECTOR_RESOURCE) continue;
        candidates.push({
          absolutePath: path.join(absolutePath, nested),
          relativePath: `${relativePath}/${nested}`,
        });
      }
    }

    for (const candidate of candidates) {
      if (seen.has(candidate.absolutePath)) continue;
      seen.add(candidate.absolutePath);

      const telemetry = await listTelemetryFiles(options.serverRoot, candidate.absolutePath, candidate.relativePath);
      installations.push({
        absolutePath: candidate.absolutePath,
        relativePath: candidate.relativePath,
        telemetryFiles: telemetry.files,
        hasTelemetryDirectory: telemetry.present,
      });
    }
  }

  return installations;
}
